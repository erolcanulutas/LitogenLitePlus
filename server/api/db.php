<?php
declare(strict_types=1);

/**
 * The database, and the tables it needs.
 *
 * SQLite by default, in a folder above the document root, so a fresh hosting
 * account needs nothing set up before the site works — no database to create,
 * no user to grant, no credentials to copy anywhere. It is a real database and
 * it is plenty for signing people in; what it is not built for is many writers
 * at once, which is a thing to think about when this starts taking payments
 * rather than now.
 *
 * Point the config file at MySQL to move: the schema below is written for both
 * and nothing above this file knows the difference.
 *
 * The schema is put up on first use rather than run by hand, so there is one
 * fewer step between a fresh account and a working site, and no way for the
 * code and the tables it expects to drift apart.
 */

function config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }

    $path = dirname(__DIR__, 2) . '/litogen-config.php';
    $cfg = is_file($path) ? require $path : [];
    if (!is_array($cfg)) {
        $cfg = [];
    }
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $cfg = config();
    $driver = isset($cfg['driver']) ? $cfg['driver'] : 'sqlite';

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    try {
        if ($driver === 'mysql') {
            $pdo = new PDO(
                "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
                $cfg['db_user'],
                $cfg['db_pass'],
                $options
            );
        } else {
            $dir = dirname(__DIR__, 2) . '/litogen-data';
            if (!is_dir($dir)) {
                @mkdir($dir, 0700, true);
            }
            $pdo = new PDO('sqlite:' . $dir . '/app.db', null, null, $options);
            // Readers do not block the writer, which is what a site wants.
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 4000');
        }
    } catch (PDOException) {
        // Never the driver's own message: it carries the host, the user and
        // sometimes the password.
        fail('Database unavailable', 500);
    }

    $auto = $driver === 'mysql'
        ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY'
        : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $tail = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS users (
            id $auto,
            email VARCHAR(190) NOT NULL UNIQUE,
            pass_hash VARCHAR(255) NOT NULL,
            plan VARCHAR(32) NOT NULL DEFAULT 'free',
            created_at DATETIME NOT NULL
        )$tail"
    );

    // Failed sign-ins, so a password cannot be guessed at machine speed. Kept
    // per address rather than per account: an attacker picks the account, and
    // locking one out on demand would be a way of doing harm in itself.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS login_misses (
            id $auto,
            ip VARCHAR(45) NOT NULL,
            at DATETIME NOT NULL
        )$tail"
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS miss_ip_at ON login_misses (ip, at)');

    // Columns added after the first accounts existed. CREATE TABLE IF NOT
    // EXISTS does nothing to a table that is already there, so these are asked
    // for separately and the complaint of already having them is the expected
    // answer rather than a failure.
    foreach ([
        'ALTER TABLE users ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE users ADD COLUMN plan_until DATETIME NULL',
    ] as $add) {
        try {
            $pdo->exec($add);
        } catch (PDOException) {
            // Already there.
        }
    }

    // Every token in and every token out, with a reason. A balance on its own
    // is a number nobody can check; this is what makes it answerable when
    // somebody says they were charged for something they did not get.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS token_ledger (
            id $auto,
            user_id INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            reason VARCHAR(64) NOT NULL,
            created_at DATETIME NOT NULL
        )$tail"
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS ledger_user ON token_ledger (user_id, created_at)');

    // A purchase we have already acted on. Webhooks are delivered more than
    // once by design — a provider that gets no answer tries again — so the
    // second delivery of a sale must not hand out the tokens twice.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS payments (
            id $auto,
            provider VARCHAR(32) NOT NULL,
            reference VARCHAR(190) NOT NULL,
            email VARCHAR(190) NOT NULL,
            item VARCHAR(190) NOT NULL,
            tokens INTEGER NOT NULL DEFAULT 0,
            months INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL
        )$tail"
    );
    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS payment_once ON payments (provider, reference)'
    );

    // Bought before signing up, or bought with a different address. The credit
    // waits here rather than being lost, and is handed over the moment an
    // account with that address exists.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS pending_credits (
            id $auto,
            email VARCHAR(190) NOT NULL,
            tokens INTEGER NOT NULL DEFAULT 0,
            months INTEGER NOT NULL DEFAULT 0,
            reason VARCHAR(64) NOT NULL,
            created_at DATETIME NOT NULL
        )$tail"
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS pending_email ON pending_credits (email)');

    // Ways of proving you are a given account, beside its password. One row per
    // provider per person, so the same account can be reached through Google
    // and through a password, and so adding Apple later is another row rather
    // than another column.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS identities (
            id $auto,
            provider VARCHAR(32) NOT NULL,
            subject VARCHAR(190) NOT NULL,
            user_id INTEGER NOT NULL,
            created_at DATETIME NOT NULL
        )$tail"
    );
    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS identity_once ON identities (provider, subject)'
    );

    return $pdo;
}

/** A cut-off timestamp, written the way both drivers read it. */
function ago(int $minutes): string
{
    return gmdate('Y-m-d H:i:s', time() - $minutes * 60);
}

function client_ip(): string
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
    return substr($ip, 0, 45);
}

/** How many sign-ins from this address have failed in the last quarter hour. */
function recent_misses(PDO $db): int
{
    $q = $db->prepare('SELECT COUNT(*) FROM login_misses WHERE ip = ? AND at > ?');
    $q->execute([client_ip(), ago(15)]);
    return (int) $q->fetchColumn();
}

function note_miss(PDO $db): void
{
    $q = $db->prepare('INSERT INTO login_misses (ip, at) VALUES (?, ?)');
    $q->execute([client_ip(), gmdate('Y-m-d H:i:s')]);
    // Nothing else clears these out, so each write takes the old ones with it.
    $db->prepare('DELETE FROM login_misses WHERE at < ?')->execute([ago(60 * 24)]);
}


/** What a new account starts with. */
const SIGNUP_TOKENS = 50;

/** Records a change in someone's balance, with a note of why. */
function note_tokens(PDO $db, int $userId, int $delta, string $reason): void
{
    $q = $db->prepare(
        'INSERT INTO token_ledger (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)'
    );
    $q->execute([$userId, $delta, $reason, gmdate('Y-m-d H:i:s')]);
}

/**
 * Whether a subscription is running, and so whether anything need be spent.
 *
 * Compared as text in UTC, which is the form both drivers store and the only
 * form they agree on.
 */
function subscribed(array $user): bool
{
    return ($user['plan'] ?? 'free') === 'sub'
        && !empty($user['plan_until'])
        && strcmp((string) $user['plan_until'], gmdate('Y-m-d H:i:s')) > 0;
}

/** Adds tokens, or extends a subscription, and writes it down. */
function grant(PDO $db, int $userId, int $tokens, int $months, string $reason): void
{
    if ($tokens > 0) {
        $db->prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?')
           ->execute([$tokens, $userId]);
        note_tokens($db, $userId, $tokens, $reason);
    }

    if ($months > 0) {
        // Extends from whenever the current one runs out, not from today, so
        // buying a second year before the first has ended does not throw the
        // remainder away.
        $q = $db->prepare('SELECT plan_until FROM users WHERE id = ?');
        $q->execute([$userId]);
        $until = (string) ($q->fetchColumn() ?: '');

        $from = ($until !== '' && strcmp($until, gmdate('Y-m-d H:i:s')) > 0)
            ? strtotime($until . ' UTC')
            : time();

        $db->prepare('UPDATE users SET plan = ?, plan_until = ? WHERE id = ?')
           ->execute(['sub', gmdate('Y-m-d H:i:s', $from + $months * 2592000), $userId]);
    }
}

/**
 * Hands over anything bought before this account existed.
 *
 * Called whenever somebody proves an address is theirs — signing up, signing
 * in, or arriving through Google. Somebody who pays and then registers gets
 * what they paid for without anyone having to notice.
 */
function claim_pending(PDO $db, int $userId, string $email): void
{
    $q = $db->prepare('SELECT id, tokens, months, reason FROM pending_credits WHERE email = ?');
    $q->execute([strtolower($email)]);
    $rows = $q->fetchAll();

    foreach ($rows as $row) {
        grant($db, $userId, (int) $row['tokens'], (int) $row['months'], (string) $row['reason']);
        $db->prepare('DELETE FROM pending_credits WHERE id = ?')->execute([$row['id']]);
    }
}

/** The account as the app is told about it. */
function account_shape(array $user): array
{
    return [
        'email' => $user['email'],
        'plan' => subscribed($user) ? 'sub' : 'free',
        'tokens' => (int) ($user['tokens'] ?? 0),
        'planUntil' => subscribed($user) ? $user['plan_until'] : null,
    ];
}
