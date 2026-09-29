// Signed URL check (spec §5.3): s = hex(HMAC-SHA256(secret, path + e)), e = unix expiry.
// The secret is the api's media_hmac.key, mounted read-only.
import fs from 'fs';
import crypto from 'crypto';

const SECRET = fs.readFileSync('/etc/nginx/secrets/media_hmac.key').toString().trim();

function check(r) {
    const e = r.args.e, s = r.args.s;
    if (!e || !s || !/^\d+$/.test(e) || Number(e) < Date.now() / 1000) {
        return '0';
    }
    const mac = crypto.createHmac('sha256', SECRET).update(r.uri + e).digest('hex');
    return mac === s ? '1' : '0';
}

export default { check };
