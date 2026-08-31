<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

require_post();

$in = body();
$email = strtolower(trim((string) ($in['email'] ?? '')));
$pass = (string) ($in['password'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
    fail('That does not look like an email address');
}
if (strlen($pass) < 8) {
    fail('Use at least eight characters');
}

$db = db();

// The time is bound rather than asked of the database: NOW() is MySQL's, and
// SQLite has no such function.
$q = $db->prepare(
    'INSERT INTO users (email, pass_hash, created_at, tokens) VALUES (?, ?, ?, ?)'
);
try {
    $q->execute([
        $email,
        password_hash($pass, PASSWORD_DEFAULT),
        gmdate('Y-m-d H:i:s'),
        SIGNUP_TOKENS,
    ]);
} catch (PDOException $e) {
    // 23000 is the unique index saying the address is taken.
    if ($e->getCode() === '23000') {
        fail('That address already has an account');
    }
    fail('Could not create the account', 500);
}

$userId = (int) $db->lastInsertId();
note_tokens($db, $userId, SIGNUP_TOKENS, 'welcome');
claim_pending($db, $userId, $email);

begin_session();
session_regenerate_id(true);
$_SESSION['uid'] = $userId;

$fresh = current_user($db);
reply(['ok' => true, 'user' => $fresh ? account_shape($fresh) : null]);
