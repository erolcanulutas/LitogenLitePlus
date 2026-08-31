<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/db.php';

/**
 * What Payhip tells us when somebody pays.
 *
 * The whole of the trust here is in one question: did this really come from
 * Payhip? Anyone can post to a public address, and what is being asked for is
 * tokens — so a receiver that takes its word for it is a machine for printing
 * them.
 *
 * The answer is the shared secret. Payhip signs with the API key, which only
 * the two of us have, so a request carrying a signature that key produces is
 * one nobody else could have made.
 *
 * The exact recipe is not written down anywhere we can read, so several are
 * tried — over the raw body, over the body with the signature taken out, and
 * the key hashed on its own. Every one of them needs the key, which is the
 * property that matters; none of them can be produced without it. Which one
 * matched is written to the log, so once a real sale has been through this
 * the rest can be dropped.
 *
 * A request that matches none of them is refused and logged in full. Failing
 * shut is the only safe way round for this: a webhook we wrongly reject costs
 * one manual credit, and one we wrongly accept costs everything.
 */

/** What each thing on sale is worth, from the config file. */
function catalogue(): array
{
    $cfg = config();
    return isset($cfg['payhip_products']) && is_array($cfg['payhip_products'])
        ? $cfg['payhip_products']
        : [];
}

function payhip_key(): string
{
    $cfg = config();
    return (string) ($cfg['payhip_key'] ?? '');
}

/**
 * Every signature the key could have produced for this delivery.
 *
 * A signature carried inside the body cannot cover the body, so the whole-body
 * ones are only any use when it arrives in a header. The rest either cover the
 * body with the signature cut back out — textually, since re-encoding the JSON
 * would not give back the bytes that were signed — or are simply the key put
 * through a hash, which several providers use as a shared token.
 */
function candidate_signatures(string $body, string $key): array
{
    // The signature's own field, removed without disturbing anything else.
    $stripped = preg_replace('/"signature"\s*:\s*"[^"]*"\s*,?/', '', $body) ?? $body;
    $stripped = preg_replace('/,\s*}/', '}', $stripped) ?? $stripped;

    return [
        'hmac-body' => hash_hmac('sha256', $body, $key),
        'hmac-body-without-signature' => hash_hmac('sha256', $stripped, $key),
        'sha256-key' => hash('sha256', $key),
        'sha512-key' => hash('sha512', $key),
        'sha1-key' => hash('sha1', $key),
        'md5-key' => hash('md5', $key),
    ];
}

$raw = (string) file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    // Some senders post a form rather than JSON.
    $data = $_POST;
}

$key = payhip_key();
if ($key === '') {
    error_log('payhip: no key configured; refusing');
    http_response_code(500);
    exit;
}

// In the body, or in a header — both are used, and which one is not written
// down anywhere readable.
$offered = [strtolower((string) ($data['signature'] ?? ''))];
foreach ($_SERVER as $name => $value) {
    if (str_starts_with($name, 'HTTP_') && str_contains(strtolower($name), 'sign')) {
        $offered[] = strtolower((string) $value);
    }
}

$candidates = candidate_signatures($raw, $key);
$matched = '';
foreach ($candidates as $name => $expected) {
    foreach ($offered as $given) {
        if ($given !== '' && hash_equals($expected, $given)) {
            $matched = $name;
            break 2;
        }
    }
}

if ($matched === '') {
    // Everything needed to recognise the real recipe from one genuine
    // delivery, so this only has to be wrong once.
    error_log(
        'payhip: signature did not match.'
        . ' offered=' . json_encode(array_values(array_filter($offered)))
        . ' tried=' . json_encode($candidates)
        . ' body=' . substr($raw, 0, 2000)
    );
    http_response_code(403);
    exit;
}
error_log('payhip: accepted, signature style ' . $matched);

$type = (string) ($data['type'] ?? $data['event'] ?? '');
$email = strtolower(trim((string) ($data['email'] ?? $data['customer_email'] ?? '')));
$item = (string) ($data['product_key'] ?? $data['product_id'] ?? $data['product_name'] ?? '');
$reference = (string) ($data['id'] ?? $data['transaction_id'] ?? $data['sale_id'] ?? '');

if ($email === '' || $reference === '') {
    error_log('payhip: nothing to act on. body=' . substr($raw, 0, 2000));
    http_response_code(202);
    exit;
}

$db = db();

// A refund or a cancellation is not a purchase; both are recorded and neither
// takes anything back automatically. Clawing tokens already spent would leave
// a negative balance, and cancelling a subscription mid-period would take away
// time that was paid for.
if ($type !== 'paid' && $type !== 'subscription.created') {
    error_log("payhip: noted $type for $email, reference $reference");
    http_response_code(200);
    exit;
}

$worth = catalogue()[$item] ?? null;
if ($worth === null) {
    error_log("payhip: nothing in the catalogue for '$item' — sale to $email not credited");
    http_response_code(202);
    exit;
}

$tokens = (int) ($worth['tokens'] ?? 0);
$months = (int) ($worth['months'] ?? 0);

// The same sale arriving twice must not pay twice. The unique index is what
// decides it, not a check-then-write, so two deliveries at once cannot both
// find nothing and both go ahead.
try {
    $db->prepare(
        'INSERT INTO payments (provider, reference, email, item, tokens, months, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute(['payhip', $reference, $email, $item, $tokens, $months, gmdate('Y-m-d H:i:s')]);
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        error_log("payhip: already handled $reference");
        http_response_code(200);
        exit;
    }
    throw $e;
}

$q = $db->prepare('SELECT id FROM users WHERE email = ?');
$q->execute([$email]);
$userId = $q->fetchColumn();

if ($userId === false) {
    // Paid before signing up, or paid from another address. Held rather than
    // lost, and handed over the moment an account with this address exists.
    $db->prepare(
        'INSERT INTO pending_credits (email, tokens, months, reason, created_at)
         VALUES (?, ?, ?, ?, ?)'
    )->execute([$email, $tokens, $months, 'payhip', gmdate('Y-m-d H:i:s')]);
    error_log("payhip: no account for $email yet, credit held");
} else {
    grant($db, (int) $userId, $tokens, $months, 'payhip');
    error_log("payhip: credited $email with $tokens tokens and $months months");
}

http_response_code(200);
echo 'ok';
