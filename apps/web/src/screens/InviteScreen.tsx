import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAccount } from '../lib/account';
import { api, apiBase, ApiRequestError } from '../lib/api';
import { navigate, routeHref } from '../lib/router';

/** Accept a team invite link (#/invite/<token>). */
export function InviteScreen({ token }: { token: string | null }) {
  const accountState = useAccount();
  const [invite, setInvite] = useState<{ team: { name: string; memberCount: number }; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = accountState.status === 'signed-in';

  useEffect(() => {
    if (!token || !signedIn) return;
    api<{ team: { name: string; memberCount: number }; role: string }>('GET', `/v1/invites/${encodeURIComponent(token)}`).then(setInvite, (e: unknown) =>
      setError(e instanceof ApiRequestError ? e.message : 'This invite could not be opened.'),
    );
  }, [token, signedIn]);

  if (!apiBase()) {
    return (
      <div className="page narrow">
        <p className="callout callout-info">This version of Material Lab is not connected to an account server, so it cannot open team invites.</p>
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div className="page narrow">
        <div className="empty-state">
          <Icon name="layers" size={28} />
          <h1>Join a team</h1>
          <p className="muted">Sign in or create an account to accept this invite. You will come back here afterwards.</p>
          <a className="btn btn-primary" href={routeHref('account')} onClick={() => sessionStorage.setItem('material-lab:after-sign-in', location.hash)}>
            Sign in to continue
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="page narrow">
      <div className="empty-state">
        <Icon name="layers" size={28} />
        {error ? (
          <>
            <h1>Invite unavailable</h1>
            <p className="muted">{error}</p>
            <a className="btn btn-secondary" href={routeHref('teams')}>
              Your teams
            </a>
          </>
        ) : !invite ? (
          <p className="muted">Opening invite…</p>
        ) : (
          <>
            <h1>Join “{invite.team.name}”</h1>
            <p className="muted">
              You are invited as {invite.role === 'owner' ? 'an owner' : `an ${invite.role}`}. The team has {invite.team.memberCount} member
              {invite.team.memberCount === 1 ? '' : 's'}.
            </p>
            <div className="button-row center">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api<{ team: { id: string } }>('POST', `/v1/invites/${encodeURIComponent(token as string)}/accept`);
                    navigate('teams', undefined, res.team.id);
                  } catch (e) {
                    if (e instanceof ApiRequestError && e.code === 'already_member' && typeof e.details.teamId === 'string') navigate('teams', undefined, e.details.teamId);
                    else setError(e instanceof ApiRequestError ? e.message : 'The invite could not be accepted.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Join team
              </button>
              <a className="btn btn-ghost" href={routeHref('home')}>
                Not now
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
