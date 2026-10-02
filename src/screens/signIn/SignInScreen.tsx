import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { MobileApiError } from '../../api/MobileApiError';
import { nextPathFrom } from '../../app/nextPath';
import { BrandMark } from '../../components/BrandMark';
import { InstallButton } from '../../components/InstallButton';
import { Button } from '../../components/form/Button';
import { Field } from '../../components/form/Field';
import { Input } from '../../components/form/Input';
import { Orb } from '../../components/Orb';
import { Panel } from '../../components/Panel';
import { StateView } from '../../components/StateView';
import { reportProblem } from '../../lib/report';
import { useBrand } from '../../queries/account';
import { useAppSession } from '../../session/AppSession';
import { appConfig } from '../../session/appConfig';
import styles from './SignInScreen.module.css';

type Step = { name: 'password' } | { name: 'code'; challenge: string; backup: boolean };

/** What a try was: the password, the code, or opening the sample world. */
type Try = 'password' | 'code' | 'sample';

/**
 * What went wrong with the last try (`of`): the platform's words, and per field where it says. It
 * shows where that try was made.
 */
type Failure = { of: Try; message: string; fields: Record<string, string> };

const SOMETHING_WRONG = 'Something went wrong. Please try again.';

function failureOf(of: Try, error: unknown): Failure {
  return MobileApiError.is(error)
    ? { of, message: error.message, fields: error.fields }
    : { of, message: SOMETHING_WRONG, fields: {} };
}

/**
 * Where to reset a password and open an account: the company's pages from its brand, or, while the
 * brand is missing, the platform's own (none in sample mode).
 */
function linksFor(brand: { links: { forgotPassword: string; register: string } } | null) {
  if (brand !== null) return brand.links;
  const { platformUrl } = appConfig;
  if (platformUrl === '') return null;
  return { forgotPassword: `${platformUrl}/forgot-password`, register: `${platformUrl}/register` };
}

/**
 * Sign-in with the platform's own account: email and password, then the two-factor step when the
 * account has it (the six-digit code, or a backup code). Creating an account and resetting a
 * password happen on the company's website. In sample mode, "Explore with sample data" signs in to
 * the sample world. Last comes the offer to install the app, where the browser has a way to. A
 * signed-in visitor goes on to where they were going (`?next=`).
 */
export function SignInScreen() {
  const { status, mode, api, platform, signIn, enterSample } = useAppSession();
  const brandQuery = useBrand();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<Try | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Tries so far: a repeated message is a new alert, announced again.
  const [tries, setTries] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const formTitleId = useId();
  const sampleTitleId = useId();
  const newTabId = useId();

  useEffect(() => {
    if (step.name === 'code') codeInput.current?.focus();
  }, [step]);

  const brand = brandQuery.data ?? null;
  if (status === 'signed-in' || status === 'locked') {
    return <Navigate to={nextPathFrom(params.get('next'))} replace />;
  }
  // The company's details did not load: a line saying so, and the way to try again. The line is
  // the screen's first row, one node from the loading view to the form, so the failure fills a
  // region already in the page; outside the header, it adds nothing to the header's layout.
  const brandFailed = brand === null && brandQuery.isError;
  const unbranded = (
    <div className={styles.unbranded} data-shown={brandFailed || undefined}>
      <p role="status" className={styles.lead}>
        {brandFailed && "The company's details couldn't be loaded."}
      </p>
      {brandFailed && (
        <Button variant="outline" size="sm" onClick={() => void brandQuery.refetch()}>
          Try again
        </Button>
      )}
    </div>
  );
  // The company's identity first: wait for it while it is on its way (never offline).
  if (status === 'loading' || (brand === null && brandQuery.fetchStatus === 'fetching')) {
    return (
      <main className={styles.screen}>
        {unbranded}
        <StateView kind="loading" className={styles.loading} />
      </main>
    );
  }

  /** Runs one try: the busy state, the failure it ends in, and a fresh alert each time. */
  async function attempt(kind: Try, run: () => Promise<void>) {
    if (busy !== null) return;
    setBusy(kind);
    setFailure(null);
    setTries((count) => count + 1);
    try {
      await run();
    } catch (error) {
      // The platform's refusals are shown as they are; anything else only as "Something went
      // wrong", so it is reported.
      if (!MobileApiError.is(error)) reportProblem('signing in', error);
      setFailure(failureOf(kind, error));
    } finally {
      setBusy(null);
    }
  }

  function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields: Record<string, string> = {};
    if (email.trim() === '') fields.email = 'Enter your email.';
    if (password === '') fields.password = 'Enter your password.';
    if (Object.keys(fields).length > 0) {
      setTries((count) => count + 1);
      setFailure({ of: 'password', message: '', fields });
      return;
    }
    void attempt('password', async () => {
      const result = await api.login({ email: email.trim(), password });
      if (result.requiresTwoFactor) {
        setCode('');
        setStep({ name: 'code', challenge: result.challenge, backup: false });
      } else {
        await signIn(result);
      }
    });
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.name !== 'code') return;
    const { challenge, backup } = step;
    void attempt('code', async () => {
      const tokens = await api.loginTwoFactor(
        backup
          ? { challenge, code: code.trim(), useBackup: true }
          : { challenge, code: code.replace(/\s/g, '') },
      );
      await signIn(tokens);
    });
  }

  const name = brand?.name ?? (appConfig.productName || 'Sign in');
  const links = linksFor(brand);
  const onPasswordStep = step.name === 'password';
  // Signing in: a message the platform tied to neither field is the form's one alert. The code
  // step has one field, which carries whatever went wrong. Opening the sample world says why it
  // did not, beside its button.
  const failed = (of: Try) => (failure?.of === of ? failure : null);
  const passwordFailure = failed('password');
  const formAlert =
    onPasswordStep &&
    passwordFailure !== null &&
    passwordFailure.message !== '' &&
    passwordFailure.fields.email === undefined &&
    passwordFailure.fields.password === undefined
      ? passwordFailure.message
      : undefined;
  const codeFailure = failed('code');
  const codeError = onPasswordStep ? undefined : (codeFailure?.fields.code ?? codeFailure?.message);
  const sampleAlert = failed('sample')?.message;
  const newTab = {
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-describedby': newTabId,
  } as const;

  return (
    <main className={styles.screen} aria-labelledby={titleId}>
      {unbranded}
      <div className={styles.column}>
        <header className={styles.hero}>
          <div className={styles.emblem} aria-hidden="true">
            {brand ? (
              <BrandMark
                name={brand.name}
                logoDataUrl={brand.logoDataUrl}
                size="lg"
                showName={false}
              />
            ) : (
              <Orb size="lg" tone="glass" />
            )}
          </div>
          <h1 id={titleId} className={styles.title}>
            {name}
          </h1>
          {brand?.tagline && <p className={styles.tagline}>{brand.tagline}</p>}
        </header>

        <Panel className={styles.panel} padding="lg" aria-labelledby={formTitleId}>
          {onPasswordStep ? (
            <form className={styles.form} onSubmit={signInWithPassword} noValidate>
              <h2 id={formTitleId} className={styles.formTitle}>
                Sign in
              </h2>
              {formAlert && (
                <p key={tries} className={styles.alert} role="alert">
                  {formAlert}
                </p>
              )}
              <Field label="Email" error={passwordFailure?.fields.email} errorKey={tries}>
                <Input
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field label="Password" error={passwordFailure?.fields.password} errorKey={tries}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button type="submit" size="lg" loading={busy === 'password'}>
                Sign in
              </Button>
              {links && (
                <a className={styles.link} href={links.forgotPassword} {...newTab}>
                  Forgot password?
                </a>
              )}
            </form>
          ) : (
            <form className={styles.form} onSubmit={verify} noValidate>
              <h2 id={formTitleId} className={styles.formTitle}>
                Two-step verification
              </h2>
              <p className={styles.lead}>
                {step.backup
                  ? 'Enter one of the backup codes you saved when you turned two-factor on.'
                  : 'Enter the six-digit code from your authenticator app.'}
              </p>
              <Field
                key={step.backup ? 'backup' : 'code'}
                label={step.backup ? 'Backup code' : 'Six-digit code'}
                error={codeError}
                errorKey={tries}
              >
                <Input
                  ref={codeInput}
                  inputMode={step.backup ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  autoCapitalize={step.backup ? 'characters' : 'off'}
                  spellCheck={false}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              <Button type="submit" size="lg" loading={busy === 'code'}>
                Verify
              </Button>
              <div className={styles.alternatives}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCode('');
                    setFailure(null);
                    setStep({ ...step, backup: !step.backup });
                  }}
                >
                  {step.backup ? 'Use the six-digit code' : 'Use a backup code'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCode('');
                    setFailure(null);
                    setStep({ name: 'password' });
                  }}
                >
                  Back
                </Button>
              </div>
            </form>
          )}
        </Panel>

        {mode === 'sample' && (
          <section className={styles.sample} aria-labelledby={sampleTitleId}>
            <h2 id={sampleTitleId} className={styles.sampleTitle}>
              Look around first
            </h2>
            <p className={styles.hint}>
              This app holds sample data. Any email signs in, with any password. Add +2fa to try the
              two-factor step; the code is 123456.
            </p>
            {sampleAlert && (
              <p key={tries} className={styles.alert} role="alert">
                {sampleAlert}
              </p>
            )}
            <Button
              variant="outline"
              size="lg"
              loading={busy === 'sample'}
              onClick={() => void attempt('sample', enterSample)}
            >
              Explore with sample data
            </Button>
          </section>
        )}

        {links && (
          <p className={styles.register}>
            New here?{' '}
            <a className={styles.link} href={links.register} {...newTab}>
              Create account
            </a>
          </p>
        )}

        <InstallButton placement="sign-in" install={platform.install} />
      </div>
      <span id={newTabId} hidden>
        Opens in a new tab
      </span>
    </main>
  );
}
