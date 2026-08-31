<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

require_post();

$in = body();
$email = strtolower(trim((string) ($in['email'] ?? '')));
$pass = (string) ($in['password'] ?? '');

$db = db();

if (recent_misses($db) >= 10) {
    fail('Too many attempts. Try again in a few minutes.', 429);
}

$q = $db->prepare('SELECT id, email, pass_hash, plan FROM users WHERE email = ?');
$q->execute([$email]);
$user = $q->fetch();

// The same answer either way: saying which half was wrong tells a stranger
// whether an address has an account here.
if (!$user || !password_verify($pass, $user['pass_hash'])) {
    note_miss($db);
    fail('Wrong address or password', 401);
}

if (password_needs_rehash($user['pass_hash'], PASSWORD_DEFAULT)) {
    $db->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')
       ->execute([password_hash($pass, PASSWORD_DEFAULT), $user['id']]);
}

begin_session();
session_regenerate_id(true);
$_SESSION['uid'] = (int) $user['id'];

reply(['ok' => true, 'user' => ['email' => $user['email'], 'plan' => $user['plan']]]);
