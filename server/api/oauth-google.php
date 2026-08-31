<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';
require __DIR__ . '/jwt.php';

/**
 * Signing in with Google.
 *
 * Google's button posts the token straight here rather than handing it to the
 * page first, so it never passes through anything a script on the page could
 * read or replace. What arrives is a form post, not a fetch — the browser is
 * being navigated — so this ends by sending the browser back to the site.
 */

const GOOGLE_CLIENT_ID = '461486745524-tbkp26t5rf2r16ttsdmvbpo7ctschkm4.apps.googleusercontent.com';

/** Back to the app, with a word about how it went. */
function go_home(string $how): never
{
    header('Location: /?signin=' . urlencode($how), true, 303);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    go_home('failed');
}

// Google sets a cookie and posts the same value in the form. Another site can
// make a browser post here, but it cannot read or write cookies for this
// domain, so it cannot make the two match.
$sent = (string) ($_POST['g_csrf_token'] ?? '');
$baked = (string) ($_COOKIE['g_csrf_token'] ?? '');
if ($sent === '' || $baked === '' || !hash_equals($baked, $sent)) {
    go_home('failed');
}

$claims = verify_google_token((string) ($_POST['credential'] ?? ''), GOOGLE_CLIENT_ID);
if ($claims === null) {
    go_home('failed');
}

$subject = (string) $claims['sub'];
$email = strtolower(trim((string) $claims['email']));

$db = db();

// Someone who has signed in with this Google account before.
$q = $db->prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?');
$q->execute(['google', $subject]);
$userId = $q->fetchColumn();

if ($userId === false) {
    // Or someone whose address we already know, from a password sign-up. The
    // address came from Google having confirmed it, so this is the same person
    // rather than a claim about being them.
    $q = $db->prepare('SELECT id FROM users WHERE email = ?');
    $q->execute([$email]);
    $userId = $q->fetchColumn();

    if ($userId === false) {
        // A new account. There is no password: sign-in is by Google until they
        // set one, and password_verify against this can never succeed.
        $q = $db->prepare('INSERT INTO users (email, pass_hash, created_at) VALUES (?, ?, ?)');
        $q->execute([$email, '', gmdate('Y-m-d H:i:s')]);
        $userId = (int) $db->lastInsertId();
    }

    $q = $db->prepare(
        'INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)'
    );
    $q->execute(['google', $subject, $userId, gmdate('Y-m-d H:i:s')]);
}

begin_session();
session_regenerate_id(true);
$_SESSION['uid'] = (int) $userId;

go_home('ok');
