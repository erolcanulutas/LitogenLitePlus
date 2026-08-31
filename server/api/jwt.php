<?php
declare(strict_types=1);

/**
 * Checking that a token really came from who it says.
 *
 * This is the part of a sign-in that has to be right. What arrives from Google
 * is a signed statement — "this is erolcan@example.com, and I checked" — and
 * the whole of its worth is in the signature. Read the claims without checking
 * it and anyone can write their own statement naming any address they like,
 * which is not a bug in the sign-in so much as the absence of one.
 *
 * So: fetch the keys Google publishes, find the one the token names, verify the
 * signature against it, and only then look at what the token says — and check
 * that too, because a genuine signature on a token minted for somebody else's
 * site is still not a reason to let anyone in.
 */

/** Base64 as URLs use it: no padding, and two of the characters swapped. */
function b64url_decode(string $s): string
{
    $s = strtr($s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) {
        $s .= str_repeat('=', 4 - $pad);
    }
    $out = base64_decode($s, true);
    return $out === false ? '' : $out;
}

/** One DER element: its tag, its length, and its body. */
function der(int $tag, string $body): string
{
    $len = strlen($body);
    if ($len < 0x80) {
        $head = chr($len);
    } else {
        $bytes = ltrim(pack('N', $len), "\x00");
        $head = chr(0x80 | strlen($bytes)) . $bytes;
    }
    return chr($tag) . $head . $body;
}

/**
 * A JSON Web Key as a PEM public key, which is what OpenSSL will take.
 *
 * Google publishes the modulus and exponent as two numbers; OpenSSL wants them
 * wrapped in the structure a certificate would carry. Both numbers are signed
 * integers in DER, so a leading byte over 0x7f has to be pushed clear of the
 * sign bit or the key comes out negative and nothing verifies.
 */
function jwk_to_pem(string $modulus, string $exponent): string
{
    $n = b64url_decode($modulus);
    $e = b64url_decode($exponent);
    if ($n === '' || $e === '') {
        return '';
    }

    if (ord($n[0]) > 0x7f) {
        $n = "\x00" . $n;
    }
    if (ord($e[0]) > 0x7f) {
        $e = "\x00" . $e;
    }

    $rsaKey = der(0x30, der(0x02, $n) . der(0x02, $e));
    $bitString = der(0x03, "\x00" . $rsaKey);
    // rsaEncryption (1.2.840.113549.1.1.1), then the NULL its parameters take.
    $algorithm = der(0x30, der(0x06, hex2bin('2a864886f70d010101')) . der(0x05, ''));
    $spki = der(0x30, $algorithm . $bitString);

    return "-----BEGIN PUBLIC KEY-----\n"
        . chunk_split(base64_encode($spki), 64, "\n")
        . "-----END PUBLIC KEY-----\n";
}

/**
 * Google's signing keys, kept for a day.
 *
 * They rotate, so they cannot be pasted into the source; they rotate slowly, so
 * fetching them on every sign-in would be a request to Google for no reason and
 * one more thing that can be down when someone is trying to get in.
 */
function google_keys(): array
{
    $dir = dirname(__DIR__, 2) . '/litogen-data';
    $cache = $dir . '/google-keys.json';

    if (is_file($cache) && time() - filemtime($cache) < 86400) {
        $held = json_decode((string) file_get_contents($cache), true);
        if (is_array($held) && $held) {
            return $held;
        }
    }

    $ch = curl_init('https://www.googleapis.com/oauth2/v3/certs');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($ch);
    $ok = $body !== false && curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
    curl_close($ch);

    $keys = $ok ? (json_decode((string) $body, true)['keys'] ?? null) : null;

    if (!is_array($keys) || !$keys) {
        // A stale copy still verifies anything signed before the rotation, and
        // is a great deal better than turning sign-in off because Google was
        // briefly unreachable.
        if (is_file($cache)) {
            $held = json_decode((string) file_get_contents($cache), true);
            if (is_array($held) && $held) {
                return $held;
            }
        }
        return [];
    }

    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    @file_put_contents($cache, json_encode($keys));

    return $keys;
}

/**
 * The claims of a Google ID token, or null if it is not one we should trust.
 *
 * @param string $token    The compact JWT as Google sent it.
 * @param string $audience Our own client id. A token minted for another site is
 *                         signed just as properly and means nothing here.
 */
function verify_google_token(string $token, string $audience): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }

    [$rawHeader, $rawClaims, $rawSignature] = $parts;

    $header = json_decode(b64url_decode($rawHeader), true);
    $claims = json_decode(b64url_decode($rawClaims), true);
    $signature = b64url_decode($rawSignature);

    if (!is_array($header) || !is_array($claims) || $signature === '') {
        return null;
    }

    // Only the one algorithm. Taking the token's word for which to use is how
    // "alg": "none" gets accepted, and it is the oldest hole in the format.
    if (($header['alg'] ?? '') !== 'RS256' || !isset($header['kid'])) {
        return null;
    }

    $pem = '';
    foreach (google_keys() as $key) {
        if (($key['kid'] ?? null) === $header['kid'] && ($key['kty'] ?? '') === 'RSA') {
            $pem = jwk_to_pem((string) ($key['n'] ?? ''), (string) ($key['e'] ?? ''));
            break;
        }
    }
    if ($pem === '') {
        return null;
    }

    $signed = $rawHeader . '.' . $rawClaims;
    if (openssl_verify($signed, $signature, $pem, OPENSSL_ALGO_SHA256) !== 1) {
        return null;
    }

    // Signed by Google, but that alone says nothing about who it was for.
    $issuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!in_array((string) ($claims['iss'] ?? ''), $issuers, true)) {
        return null;
    }
    if ((string) ($claims['aud'] ?? '') !== $audience) {
        return null;
    }

    $now = time();
    // A minute either way, because two clocks are never quite the same.
    if (($claims['exp'] ?? 0) < $now - 60) {
        return null;
    }
    if (($claims['iat'] ?? 0) > $now + 60) {
        return null;
    }

    if (empty($claims['sub']) || empty($claims['email'])) {
        return null;
    }
    // Google will hand over an address it has not confirmed. Trusting one would
    // let somebody sign in as the owner of an address they merely typed.
    if (($claims['email_verified'] ?? false) !== true && ($claims['email_verified'] ?? '') !== 'true') {
        return null;
    }

    return $claims;
}
