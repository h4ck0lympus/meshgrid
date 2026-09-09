import { pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(pbkdf2);

export const CHALLENGE_ITERATIONS = 120_000;
export const CHALLENGE_TIMEOUT_MS = 5_000;
export const VERIFICATION_VALID_MS = 60_000;
export const VERIFICATION_REFRESH_MS = 30_000;

export async function solveChallenge(challenge) {
  if (challenge.algorithm !== 'pbkdf2-sha256-v1' ||
      challenge.iterations !== CHALLENGE_ITERATIONS ||
      !/^[a-f0-9]{64}$/.test(challenge.nonce) ||
      !/^[a-f0-9]{32}$/.test(challenge.salt)) {
    throw new Error('Unsupported computation challenge.');
  }
  const derived = await deriveKey(Buffer.from(challenge.nonce, 'hex'),
    Buffer.from(challenge.salt, 'hex'), CHALLENGE_ITERATIONS, 32, 'sha256');
  return derived.toString('hex');
}
