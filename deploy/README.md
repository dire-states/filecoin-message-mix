# Running the updates on the node host

These steps set up the count, commit and push runs, 4 times a day, on the host that runs the Lotus
nodes, under `/opt/dire-states`, next to sector-spiegel. Your admin login (e.g. `ptrk`) owns the files
there, and the service runs as root. Run the steps as that login; `sudo` marks what needs root.

Each data repo gets its own new **deploy key**, because GitHub allows a deploy key on one repo
only. Each key can push to its own data repo and nothing else. The app repo is public and is cloned
over HTTPS.

Run often enough: the nodes keep about 1.8 days of messages, and heights a run comes too late for are
lost (recorded as gaps). Every 6 hours leaves plenty of room for a host that is down for a while.

## 1. Prerequisites

`/opt/dire-states`, Node 26 at `/opt/dire-states/node` and `/opt/dire-states/.ssh/known_hosts` are
shared with sector-spiegel. If they are not there yet, set them up as in sector-spiegel's
`deploy/README.md`, steps 1–3 (prerequisites, directories, `ssh-keyscan`). Then:

```sh
node --version     # >= 23.6, runs .ts directly
mkdir -p /opt/dire-states/message-mix
```

## 2. Deploy keys

```sh
cd /opt/dire-states
for repo in data-main data-calibration; do
  ssh-keygen -t ed25519 -N '' -C "message-mix-$repo@$(hostname)" -f .ssh/message-mix-$repo
done
cat .ssh/message-mix-data-main.pub .ssh/message-mix-data-calibration.pub
```

On GitHub, add each public key to its repo under **Settings → Deploy keys → Add deploy key**, with
**Allow write access** ticked. Delete any old key of a previous install there.

- `message-mix-data-main.pub` → `dire-states/filecoin-message-mix-data-main`
- `message-mix-data-calibration.pub` → `dire-states/filecoin-message-mix-data-calibration`

## 3. Clone

```sh
cd /opt/dire-states/message-mix
git clone https://github.com/dire-states/filecoin-message-mix.git
for repo in data-main data-calibration; do
  git clone \
    -c core.sshCommand="ssh -i /opt/dire-states/.ssh/message-mix-$repo -o IdentitiesOnly=yes -o UserKnownHostsFile=/opt/dire-states/.ssh/known_hosts" \
    -c user.name=dire-states -c user.email=339008527+dire-states@users.noreply.github.com \
    git@github.com:dire-states/filecoin-message-mix-$repo.git
done
# Root's git refuses repos owned by another user unless they are marked safe.
for r in filecoin-message-mix filecoin-message-mix-data-main filecoin-message-mix-data-calibration; do
  sudo git config --system --add safe.directory /opt/dire-states/message-mix/$r
done
```

Unlike sector-spiegel, the data is small and its full history is pushed: each run adds one commit to
`main`, and the clones carry on from the last published height.

## 4. Test by hand

```sh
cd /opt/dire-states/message-mix/filecoin-message-mix
sudo NO_PUSH=1 scripts/publish.sh calibnet   # commits, no push
sudo scripts/publish.sh calibnet             # pushes, including the commit above
sudo scripts/publish.sh mainnet              # ~10 s
```

Each run ends with `<net>: published <commit> window …` and `<net>: done in <N>s`. The nodes default
to `192.168.50.123:1234` (mainnet) and `:1235` (calibnet); set `LOTUS_API` if they live elsewhere.

## 5. Schedule

The units are linked from this repo, not copied, so a pull plus `daemon-reload` applies changes.
`/opt` must be on the root filesystem for linked units to load at boot.

```sh
D=/opt/dire-states/message-mix/filecoin-message-mix/deploy
sudo systemctl link $D/message-mix@.service
sudo systemctl enable --now $D/message-mix-calibnet.timer $D/message-mix-mainnet.timer
systemctl list-timers 'message-mix*' 'sector-spiegel*'
sudo systemctl start message-mix@calibnet   # one run through systemd, to check the unit
```

Calibnet runs at 00:30, 06:30, 12:30 and 18:30, and mainnet 5 minutes later, clear of sector-spiegel's
runs at :00 and :10. A run missed while the host was down starts at the next boot.

- Run now: `sudo systemctl start message-mix@mainnet`
- Logs: `sudo journalctl -u message-mix@mainnet -e`
- Failures: `systemctl --failed`. A run that fails while counting, for example a node out of sync or
  unreachable, writes and commits nothing, and the next run picks up normally. A failed push leaves
  the commit local; the next run pushes it.
- Unlike sector-spiegel, a data repo with uncommitted changes stops the runs (`publish.sh` refuses),
  because the counts merge into the files on disk. Look at `git -C <data repo> status` and fix it by
  hand.

## Updating the scripts

```sh
git -C /opt/dire-states/message-mix/filecoin-message-mix pull
sudo systemctl daemon-reload    # if a unit file changed
```
