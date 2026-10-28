import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

// Hosted visitors receive an anonymous, signed browser session. This prevents
// public visitors from reading the owner's pre-existing local Atlas history.
export function workspaceSession(secret) {
  if (!secret || secret.length < 32)
    throw new AppError(
      'Configure a private SESSION_SECRET before hosting the app.',
      503,
      'SESSION_NOT_CONFIGURED',
    );
  const signature = (id) => createHmac('sha256', secret).update(id).digest('hex');
  return (request, response, next) => {
    const value =
      request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('hv-workspace='))
        ?.slice('hv-workspace='.length) || '';
    const [candidate, signed] = value.split('.');
    let id;
    if (
      /^[a-f0-9]{64}$/.test(candidate || '') &&
      /^[a-f0-9]{64}$/.test(signed || '') &&
      timingSafeEqual(Buffer.from(signed, 'hex'), Buffer.from(signature(candidate), 'hex'))
    )
      id = candidate;
    else {
      id = randomBytes(32).toString('hex');
      response.append(
        'Set-Cookie',
        `hv-workspace=${id}.${signature(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`,
      );
    }
    request.workspaceId = createHash('sha256').update(id).digest('hex');
    next();
  };
}

export function publicCheck(check) {
  if (!check) return check;
  const { ownerId: _private, ...result } = check;
  if (result.claims)
    result.claims = result.claims.map((claim) => {
      if (!claim.repeatResult?.comparisons) return claim;
      return {
        ...claim,
        repeatResult: {
          ...claim.repeatResult,
          comparisons: claim.repeatResult.comparisons.map(
            ({ answer: _answer, reviewQuote: _quote, ...status }) => status,
          ),
        },
      };
    });
  return result;
}
