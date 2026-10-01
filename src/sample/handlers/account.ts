// Sign-in, the session and the account (auth/*, brand, me/*), with the platform's rules in each
// route's order. In the sample any email signs in; an email containing "+2fa", or an account with
// two-factor turned on, takes the two-factor step, whose code is 123456. The sample password for
// the password-gated actions is "sample" until the investor changes it.
//
// Signing out always succeeds, as POST /auth/logout answers `{ ok: true }` whatever the tokens
// (a public route, even for a revoked session or a closed account).
//
// Sample-only simplifications: the sign-in, re-authentication and PIN rate limits are not kept (a
// quick demo would trip them), tokens are opaque sample strings, and signing out ends nothing,
// since there are no tokens to revoke.
import { z } from 'zod';
import type { Brand, LoginResult, Me, MobileTokens, SessionView } from '../../api/types';
import type { SampleContext } from './context';
import { fail, parse, requirePassword } from './context';
import { iso, isoOrNull, tierView, unreadCount } from './views';

/** The two-factor code that works in the sample, at sign-in and to turn two-factor on. */
const SAMPLE_CODE = '123456';
const SAMPLE_SECRET = 'SAMPLESECRETPREVIEWONLY234567ABC';
const ACCESS_MS = 15 * 60_000;
const REFRESH_MS = 30 * 86_400_000;
const SESSIONS_LISTED = 25;

const LoginBody = z.object({
  // Trimmed (phone keyboards add spaces); case is kept, exactly as the website matches it.
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
});
const TwoFactorBody = z.object({
  challenge: z.string().min(1).max(4096),
  code: z.string().trim().min(1).max(64),
  useBackup: z.boolean().optional(),
});
const PrefsBody = z
  .object({
    deposit: z.boolean(),
    withdrawal: z.boolean(),
    referral: z.boolean(),
    support: z.boolean(),
    kyc: z.boolean(),
    security: z.boolean(),
    system: z.boolean(),
  })
  .strict();
const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});
const PinBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  pin: z.string().regex(/^\d{4,8}$/, 'Use 4 to 8 digits.'),
});
const RevokeBody = z.object({ sessionId: z.string().min(1).max(64) });
const ReauthBody = z.object({ currentPassword: z.string().min(1).max(1024) });
const EnableBody = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

function tokens(ctx: SampleContext): MobileTokens {
  const now = ctx.now().getTime();
  const id = ctx.newId('token');
  return {
    tokenType: 'Bearer',
    accessToken: `sample-access-${id}`,
    refreshToken: `sample-refresh-${id}`,
    accessExpiresAt: iso(new Date(now + ACCESS_MS)),
    refreshExpiresAt: iso(new Date(now + REFRESH_MS)),
  };
}

/** A sign-in that succeeded starts this device's session again, as a new one if it was revoked. */
function signIn(ctx: SampleContext): MobileTokens {
  const { state } = ctx;
  const now = ctx.now();
  if (!state.sessions.some((s) => s.id === state.currentSessionId)) {
    const id = ctx.newId('sess');
    state.sessions.unshift({
      id,
      device: 'Web app on this browser',
      ipAddress: null,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_MS),
    });
    state.currentSessionId = id;
  }
  state.user.lastLoginAt = now;
  ctx.session.ended = false;
  return tokens(ctx);
}

export function login(ctx: SampleContext, body: unknown): LoginResult {
  const { email } = parse(LoginBody, body);
  // A closed account's email answers like an unknown one.
  if (ctx.state.user.closed) {
    fail('invalid_credentials', 401, 'The email or password is incorrect.');
  }
  if (email.toLowerCase().includes('+2fa') || ctx.state.user.twoFactorEnabled) {
    const challenge = ctx.newId('challenge');
    ctx.challenges.add(challenge);
    return { requiresTwoFactor: true, challenge };
  }
  return { requiresTwoFactor: false, ...signIn(ctx) };
}

export function loginTwoFactor(ctx: SampleContext, body: unknown): MobileTokens {
  const { challenge, code, useBackup } = parse(TwoFactorBody, body);
  if (!ctx.challenges.has(challenge)) {
    fail('invalid_challenge', 401, 'This sign-in step expired. Start again.');
  }
  if (useBackup) {
    const codes = ctx.state.user.backupCodes;
    const index = codes.indexOf(code);
    if (index < 0) fail('invalid_code', 401, 'That code is not valid.');
    codes.splice(index, 1);
  } else if (code !== SAMPLE_CODE) {
    fail('invalid_code', 401, 'That code is not valid.');
  }
  ctx.challenges.delete(challenge);
  return signIn(ctx);
}

export function refresh(ctx: SampleContext): MobileTokens {
  return tokens(ctx);
}

export function logout(): void {}

export function brand(ctx: SampleContext): Brand {
  return ctx.state.brand;
}

export function me(ctx: SampleContext): Me {
  const { state } = ctx;
  const { user } = state;
  return {
    id: user.id,
    fullName: user.fullName,
    firstName: user.fullName.split(' ')[0] || user.fullName,
    email: user.email,
    tag: user.tag,
    emailVerified: user.emailVerified,
    kycStatus: state.kyc.status,
    tier: tierView(user.tier),
    security: { twoFactorEnabled: user.twoFactorEnabled, pinEnabled: user.pin !== null },
    notificationPrefs: user.notificationPrefs,
    unreadCount: unreadCount(state),
    memberSince: iso(user.memberSince),
    lastLoginAt: isoOrNull(user.lastLoginAt),
    sessionId: state.currentSessionId,
  };
}

export function setNotificationPrefs(ctx: SampleContext, body: unknown) {
  const notificationPrefs = parse(PrefsBody, body);
  ctx.state.user.notificationPrefs = notificationPrefs;
  return { notificationPrefs };
}

/** The platform's password policy, in its order. */
function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push('must be at least 12 characters');
  if (!/[A-Z]/.test(password)) problems.push('must include an uppercase letter');
  if (!/[a-z]/.test(password)) problems.push('must include a lowercase letter');
  if (!/\d/.test(password)) problems.push('must include a digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('must include a symbol');
  return problems;
}

export function changePassword(ctx: SampleContext, body: unknown): void {
  const { currentPassword, newPassword } = parse(PasswordBody, body);
  requirePassword(ctx, currentPassword);
  const problems = passwordProblems(newPassword);
  if (problems.length > 0) {
    fail('weak_password', 400, 'New password does not meet the policy.', { detail: problems });
  }
  if (newPassword === currentPassword) {
    fail('same_password', 400, 'New password must differ from the current one.');
  }
  ctx.state.user.password = newPassword;
}

export function setPin(ctx: SampleContext, body: unknown): void {
  const { currentPassword, pin } = parse(PinBody, body);
  requirePassword(ctx, currentPassword);
  ctx.state.user.pin = pin;
}

export function sessions(ctx: SampleContext): SessionView[] {
  const { state } = ctx;
  const now = ctx.now().getTime();
  return [...state.sessions]
    .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
    .slice(0, SESSIONS_LISTED)
    .map((s) => ({
      id: s.id,
      device: s.device,
      ipAddress: s.ipAddress,
      issuedAt: iso(s.issuedAt),
      expiresAt: iso(s.expiresAt),
      expired: s.expiresAt.getTime() <= now,
      current: s.id === state.currentSessionId,
    }));
}

export function revokeSession(
  ctx: SampleContext,
  sessionId: string,
): { ok: true; current: boolean } {
  const body = parse(RevokeBody, { sessionId });
  const { state } = ctx;
  if (!state.sessions.some((s) => s.id === body.sessionId)) {
    fail('session_not_found', 404, 'Session not found.');
  }
  state.sessions = state.sessions.filter((s) => s.id !== body.sessionId);
  const current = body.sessionId === state.currentSessionId;
  if (current) ctx.session.ended = true;
  return { ok: true, current };
}

export function enrollTwoFactor(ctx: SampleContext, body: unknown) {
  const { currentPassword } = parse(ReauthBody, body);
  const { user } = ctx.state;
  if (user.twoFactorEnabled) {
    fail('already_enabled', 400, 'Two-factor is already enabled. Disable it first to re-enroll.');
  }
  requirePassword(ctx, currentPassword);
  user.twoFactorSecret = SAMPLE_SECRET;
  const issuer = encodeURIComponent(ctx.state.brand.name);
  return {
    secret: SAMPLE_SECRET,
    uri: `otpauth://totp/${issuer}:${encodeURIComponent(user.email)}?secret=${SAMPLE_SECRET}&issuer=${issuer}`,
    account: user.email,
  };
}

export function enableTwoFactor(ctx: SampleContext, body: unknown): { backupCodes: string[] } {
  const { code } = parse(EnableBody, body);
  const { user } = ctx.state;
  if (user.twoFactorSecret === null) {
    fail('not_enrolled', 400, 'Start enrollment first to get your secret.');
  }
  if (user.twoFactorEnabled) fail('already_enabled', 400, 'Two-factor is already enabled.');
  if (code !== SAMPLE_CODE) fail('invalid_code', 403, 'The code is incorrect. Try again.');
  user.twoFactorEnabled = true;
  user.backupCodes = Array.from({ length: 10 }, (_, i) => `SMPL-${String(i + 1).padStart(4, '0')}`);
  return { backupCodes: [...user.backupCodes] };
}

export function disableTwoFactor(ctx: SampleContext, body: unknown): void {
  const { currentPassword } = parse(ReauthBody, body);
  requirePassword(ctx, currentPassword);
  const { user } = ctx.state;
  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  user.backupCodes = [];
}

export function closeAccount(ctx: SampleContext, body: unknown): void {
  const { currentPassword } = parse(ReauthBody, body);
  requirePassword(ctx, currentPassword);
  const { state } = ctx;
  const open = state.positions.filter((p) => p.status === 'ACTIVE' || p.status === 'MATURED');
  if (open.length > 0) {
    fail('active_holdings', 409, 'Close your active positions first.', {
      detail: [String(open.length)],
    });
  }
  // Every session ends, this device's included, and the email no longer signs in.
  state.user.closed = true;
  state.sessions = [];
  ctx.session.ended = true;
}
