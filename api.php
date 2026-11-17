<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json');

function reply(array $data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function state(): array
{
    $db = db();
    return [
        'categories' => $db->query('SELECT * FROM categories ORDER BY name')->fetchAll(),
        'plans'      => $db->query('SELECT * FROM plans ORDER BY date, start_time')->fetchAll(),
        'exceptions' => $db->query('SELECT * FROM plan_exceptions')->fetchAll(),
        'bucket'     => $db->query('SELECT * FROM bucket ORDER BY id')->fetchAll(),
        'todos'      => $db->query('SELECT * FROM todos ORDER BY deadline IS NULL, deadline, id')->fetchAll(),
    ];
}

function find_plan(int $id): array
{
    $st = db()->prepare('SELECT * FROM plans WHERE id = ?');
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) throw new BadInput("plan #$id does not exist");
    return $p;
}

function category_id($tag): ?int
{
    if ($tag === null || $tag === '') return null;
    $st = db()->prepare('SELECT id FROM categories WHERE tag = ?');
    $st->execute([(string)$tag]);
    $id = $st->fetchColumn();
    if ($id === false) throw new BadInput("unknown category [$tag]");
    return (int)$id;
}

function find_todo(int $id): array
{
    $st = db()->prepare('SELECT * FROM todos WHERE id = ?');
    $st->execute([$id]);
    $t = $st->fetch();
    if (!$t) throw new BadInput("to do #$id does not exist");
    return $t;
}

function check_repeat($v, array $allowed): string
{
    if (!in_array($v, $allowed, true)) throw new BadInput('repeat must be one of: ' . implode(', ', $allowed));
    return $v;
}

function save_exception(int $planId, $date, array $e): void
{
    $date = check_date($date);
    $new = [null, null, null];
    if (!empty($e['new_date'])) {
        $new = [check_date($e['new_date']), check_time($e['new_start'] ?? null), check_time($e['new_end'] ?? null)];
        check_times($new[1], $new[2]);
    }
    db()->prepare('INSERT OR REPLACE INTO plan_exceptions (plan_id, date, new_date, new_start, new_end) VALUES (?, ?, ?, ?, ?)')->execute([$planId, $date, ...$new]);
}

function check_times(string $start, string $end): void
{
    if ($end <= $start) throw new BadInput('end time must be after start time');
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(['error' => 'POST only'], 405);
if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF'] ?? '')) reply(['error' => 'session expired, reload the page'], 403);

$in = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $in['action'] ?? '';
$db = db();

try {
    // login
    if ($action === 'login') {
        $user = $db->query('SELECT * FROM user LIMIT 1')->fetch();
        if (!$user) reply(['error' => 'no account yet, run: php setup.php'], 400);
        if ($user['locked_until'] > time()) {
            reply(['error' => 'too many wrong tries, wait ' . ($user['locked_until'] - time()) . ' seconds'], 429);
        }

        $ok = hash_equals($user['username'], (string)($in['username'] ?? '')) && password_verify((string)($in['password'] ?? ''), $user['password_hash']);
        if (!$ok) {
            $failed = $user['failed_logins'] + 1;
            $lock = $failed >= 5 ? time() + 300 : 0;   // 5 wrong tries = 5 minutes locked
            $db->prepare('UPDATE user SET failed_logins = ?, locked_until = ? WHERE id = ?')
               ->execute([$lock ? 0 : $failed, $lock, $user['id']]);
            reply(['error' => 'login incorrect'], 401);
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['last_login'] = $user['last_login'];
        $_SESSION['username'] = $user['username'];
        $db->prepare('UPDATE user SET failed_logins = 0, last_login = ? WHERE id = ?')->execute([date('Y-m-d H:i'), $user['id']]);
        reply(['ok' => true]);
    }

    if (!logged_in()) reply(['error' => 'not logged in'], 401);
    $result = [];

    switch ($action) {
        case 'state':
            break;

        case 'logout':
            $_SESSION = [];
            session_destroy();
            reply(['ok' => true]);

        // plans
        case 'plan_add':
            $repeat = check_repeat($in['repeat_type'] ?? 'none', PLAN_REPEATS);
            $start = check_time($in['start_time'] ?? null);
            $end = check_time($in['end_time'] ?? null);
            check_times($start, $end);
            $db->prepare('INSERT INTO plans (title, category_id, location, notes, date, start_time, end_time, repeat_type, travel_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
               ->execute([
                   check_text($in['title'] ?? '', 100, true),
                   category_id($in['tag'] ?? null),
                   check_text($in['location'] ?? '', 100),
                   check_text($in['notes'] ?? '', 1000),
                   check_date($in['date'] ?? null),
                   $start, $end, $repeat,
                   check_travel($in['travel_minutes'] ?? 0),
               ]);
            $result['id'] = (int)$db->lastInsertId();
            break;

        case 'plan_edit':
            $p = find_plan((int)($in['id'] ?? 0));
            $f = $in['fields'] ?? [];
            if (array_key_exists('title', $f)) 
                $p['title'] = check_text($f['title'], 100, true);

            if (array_key_exists('tag', $f))      
                $p['category_id'] = category_id($f['tag']);

            if (array_key_exists('location', $f)) 
                $p['location'] = check_text($f['location'], 100);

            if (array_key_exists('notes', $f))    
                $p['notes'] = check_text($f['notes'], 1000);

            if (array_key_exists('date', $f))     
                $p['date'] = check_date($f['date']);

            if (array_key_exists('until_date', $f)) 
                $p['until_date'] = $f['until_date'] === null ? null : check_date($f['until_date']);

            if (array_key_exists('travel_minutes', $f)) 
                $p['travel_minutes'] = check_travel($f['travel_minutes']);

            if (array_key_exists('start_time', $f)) {
                $p['start_time'] = check_time($f['start_time']);
                $p['end_time'] = check_time($f['end_time'] ?? null);
            }
            check_times($p['start_time'], $p['end_time']);
            $db->prepare('UPDATE plans SET title=?, category_id=?, location=?, notes=?, date=?, start_time=?, end_time=?, until_date=?, travel_minutes=? WHERE id=?')->execute([$p['title'], $p['category_id'], $p['location'], $p['notes'], $p['date'], $p['start_time'], $p['end_time'], $p['until_date'], $p['travel_minutes'], $p['id']]);
            break;

        case 'plan_rm':
            $p = find_plan((int)($in['id'] ?? 0));
            $db->prepare('DELETE FROM plans WHERE id = ?')->execute([$p['id']]);
            break;

        case 'plan_restore'; // undo of rm
            $p = $in['plan'] ?? [];
            $start = check_time($p['start_time'] ?? null);
            $end = check_time($p['end_time'] ?? null);
            check_times($start, $end);
            $cat = $p['category_id'] ?? null;
            if ($cat !== null) {
                $st = $db->prepare('SELECT id FROM categories WHERE id = ?');
                $st->execute([(int)$cat]);
                $cat = $st->fetchColumn() === false ? null : (int)$cat;
            }
            $db->beginTransaction();
            $db->prepare('INSERT INTO plans (id, title, category_id, location, notes, date, start_time, end_time, repeat_type, until_date, travel_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
               ->execute([
                   (int)($p['id'] ?? 0),
                   check_text($p['title'] ?? '', 100, true),
                   $cat,
                   check_text($p['location'] ?? '', 100),
                   check_text($p['notes'] ?? '', 1000),
                   check_date($p['date'] ?? null),
                   $start, $end,
                   check_repeat($p['repeat_type'] ?? 'none', PLAN_REPEATS),
                   ($p['until_date'] ?? null) === null ? null : check_date($p['until_date']),
                   check_travel($p['travel_minutes'] ?? 0),
               ]);
            foreach (($in['exceptions'] ?? []) as $e) save_exception((int)$p['id'], $e['date'] ?? null, $e);
            $db->commit();
            break;

        case 'skip':
        case 'move':
            $p = find_plan((int)($in['id'] ?? 0));
            $date = check_date($in['date'] ?? null);
            if ($p['repeat_type'] === 'none') throw new BadInput("#{$p['id']} doesn't repeat, use edit instead");
            if (!occurs_on($p, $date)) throw new BadInput("#{$p['id']} doesn't happen on $date");
            if ($action === 'move' && empty($in['new_date'])) throw new BadInput('move needs a new date');
            save_exception($p['id'], $date, $action === 'move' ? $in : ['new_date' => null]);
            break;

        case 'exception_restore': // undo of skip/move
            $p = find_plan((int)($in['id'] ?? 0));
            $date = check_date($in['date'] ?? null);
            $db->prepare('DELETE FROM plan_exceptions WHERE plan_id = ? AND date = ?')->execute([$p['id'], $date]);
            if (!empty($in['previous'])) save_exception($p['id'], $date, $in['previous']);
            break;

        case 'stop':
            $p = find_plan((int)($in['id'] ?? 0));
            if ($p['repeat_type'] === 'none') throw new BadInput("#{$p['id']} doesn't repeat");
            $until = check_date($in['until'] ?? null);
            if ($until < $p['date']) throw new BadInput('that is before the series starts, use rm instead');
            $db->prepare('UPDATE plans SET until_date = ? WHERE id = ?')->execute([$until, $p['id']]);
            break;
            
        // Categories (tags)
        case 'cat_add':
        case 'cat_restore':   // undo of cat rm
            $c = $action === 'cat_add' ? $in : ($in['category'] ?? []);
            $tag = check_text($c['tag'] ?? '', 3, true);
            if (!preg_match('/^[^\s\[\]]+$/u', $tag)) throw new BadInput('a tag cannot contain spaces or brackets');
            $border = $c['border'] ?? '';
            if (!in_array($border, BORDERS, true)) throw new BadInput('border must be one of: ' . implode(', ', BORDERS));
            $db->beginTransaction();
            try {
                $db->prepare('INSERT INTO categories (id, name, tag, border) VALUES (?, ?, ?, ?)')
                   ->execute([$action === 'cat_restore' ? (int)($c['id'] ?? 0) : null, check_text($c['name'] ?? '', 30, true), $tag, $border]);
            } catch (PDOException $e) {
                $db->rollBack();
                throw new BadInput("tag [$tag] is already used");
            }
            $result['id'] = (int)$db->lastInsertId();
            $set = $db->prepare('UPDATE plans SET category_id = ? WHERE id = ? AND category_id IS NULL');
            foreach (($in['plan_ids'] ?? []) as $pid) $set->execute([$result['id'], (int)$pid]);
            $db->commit();
            break;

        case 'cat_rm':
            $id = category_id($in['tag'] ?? '');
            $db->beginTransaction();
            $db->prepare('UPDATE plans SET category_id = NULL WHERE category_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM categories WHERE id = ?')->execute([$id]);
            $db->commit();
            break;

        // todo list
        case 'todo_add':
        case 'todo_restore': // undo
            $t = $action === 'todo_add' ? $in : ($in['todo'] ?? []);
            $deadline = ($t['deadline'] ?? null) === null ? null : check_date($t['deadline']); // null = no deadline
            $repeat = check_repeat($t['repeat_type'] ?? 'none', TODO_REPEATS);
            if ($deadline === null && $repeat !== 'none') throw new BadInput('a repeating to do needs a deadline');
            $db->prepare('INSERT OR REPLACE INTO todos (id, title, deadline, notes, repeat_type, created) VALUES (?, ?, ?, ?, ?, ?)')->execute([
                   $action === 'todo_restore' ? (int)($t['id'] ?? 0) : null,
                   check_text($t['title'] ?? '', 100, true),
                   $deadline,
                   check_text($t['notes'] ?? '', 1000),
                   $repeat,
                   $action === 'todo_restore' ? check_date($t['created'] ?? null) : date('Y-m-d'),
               ]);
            $result['id'] = (int)$db->lastInsertId();
            break;

        case 'todo_edit':
            $t = find_todo((int)($in['id'] ?? 0));
            $f = $in['fields'] ?? [];
            if (array_key_exists('title', $f))       
                $t['title'] = check_text($f['title'], 100, true);

            if (array_key_exists('deadline', $f))    
                $t['deadline'] = $f['deadline'] === null ? null : check_date($f['deadline']);

            if (array_key_exists('notes', $f))       
                $t['notes'] = check_text($f['notes'], 1000);

            if (array_key_exists('repeat_type', $f)) 
                $t['repeat_type'] = check_repeat($f['repeat_type'], TODO_REPEATS);

            if ($t['deadline'] === null && $t['repeat_type'] !== 'none') throw new BadInput('a repeating to do needs a deadline');
            $db->prepare('UPDATE todos SET title = ?, deadline = ?, notes = ?, repeat_type = ? WHERE id = ?')->execute([$t['title'], $t['deadline'], $t['notes'], $t['repeat_type'], $t['id']]);
            break;

        case 'todo_done':
            $t = find_todo((int)($in['id'] ?? 0));
            if ($t['repeat_type'] === 'none') {
                $db->prepare('DELETE FROM todos WHERE id = ?')->execute([$t['id']]);
            } else { // repeating
                $result['next'] = next_date($t['deadline'], $t['repeat_type']);
                $db->prepare('UPDATE todos SET deadline = ? WHERE id = ?')->execute([$result['next'], $t['id']]);
            }
            break;

        case 'todo_rm': // undo of todo add
            $t = find_todo((int)($in['id'] ?? 0));
            $db->prepare('DELETE FROM todos WHERE id = ?')->execute([$t['id']]);
            break;

        //bucket list
        case 'bucket_add':
            $db->prepare('INSERT INTO bucket (title, notes, created) VALUES (?, ?, ?)')->execute([check_text($in['title'] ?? '', 100, true), check_text($in['notes'] ?? '', 1000), date('Y-m-d')]);
            break;

        case 'bucket_set':
            $status = $in['status'] ?? '';
            if (!in_array($status, ['completed', 'failed'], true)) throw new BadInput('bad status');
            $st = $db->prepare("UPDATE bucket SET status = ?, resolved = ? WHERE id = ? AND status = 'open'");
            $st->execute([$status, date('Y-m-d'), (int)($in['id'] ?? 0)]);
            if ($st->rowCount() === 0) throw new BadInput('that item does not exist or is already final');
            break;

        default:
            reply(['error' => 'unknown action'], 400);
    }
    reply(['ok' => true, 'state' => state()] + $result);
} catch (BadInput $e) {
    reply(['error' => $e->getMessage()], 400);
}