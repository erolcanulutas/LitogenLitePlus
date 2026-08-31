<?php
declare(strict_types=1);

/**
 * The small shared parts: how a reply looks, how a session is set up, and how
 * a request body is read.
 */

/**
 * Anything thrown that nobody caught still leaves as JSON.
 *
 * Otherwise PHP stops mid-reply and the caller gets an empty body with a 500,
 * which tells whoever is looking at it nothing at all. The message itself goes
 * to the log and not to the browser: it names files, and often the database.
 */
set_exception_handler(static function (Throwable $e): void {
    error_log('litogen: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['ok' => false, 'error' => 'Something went wrong']);
});

/** Sends `$data` as JSON and stops. */
function reply(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): never
{
    reply(['ok' => false, 'error' => $message], $status);
}

/**
 * Starts the session with a cookie that is no use to anyone but this site.
 *
 * HttpOnly keeps it away from scripts, Secure keeps it off plain HTTP, and
 * SameSite=Lax means another site cannot make the browser send it along with a
 * request it forged — which is most of what a CSRF token would otherwise be
 * for here.
 */
function begin_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path'     => '/',
        'secure'   => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('litogen');
    session_start();
}

/** The JSON body of the request, or an empty array. */
function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Refuses anything but a POST that says it came from a script of ours. */
function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        fail('Use POST', 405);
    }
    // A form on another site can be made to POST here, but it cannot set a
    // header. Together with SameSite this is enough to keep forged requests out.
    if (($_SERVER['HTTP_X_LITOGEN'] ?? '') !== '1') {
        fail('Not allowed', 403);
    }
}

/** Whoever is asking, as far as the browser has proved it. */
function current_user(PDO $db): ?array
{
    begin_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) {
        return null;
    }

    $q = $db->prepare(
        'SELECT id, email, plan, tokens, plan_until, created_at FROM users WHERE id = ?'
    );
    $q->execute([$id]);
    $row = $q->fetch();
    return $row ?: null;
}
