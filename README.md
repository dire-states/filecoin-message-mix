# filecoin-message-mix

What the Filecoin chain is doing, by message type. Every message on mainnet and calibnet is counted
by the receiving actor type and method (`miner.SubmitWindowedPoSt`, `evm.InvokeContract`,
`account.Send`, …) in hourly buckets. The result is a time series you can browse.

Live at https://dire-states.github.io/filecoin-message-mix/

## Repos

```
message-mix/
  filecoin-message-mix/                   this repo: the site (Vite + React + uPlot) and the scripts
  filecoin-message-mix-data-main/         mainnet counts: README, daily.csv, days/YYYY/MM/<day>.csv, index.json
  filecoin-message-mix-data-calibration/  calibnet counts
```

The data repos are browsable on GitHub as they are. Each has a generated README listing the last 30
days, with links to the hourly CSV files, which GitHub shows as searchable tables. Their full history
is published.

## Develop

```sh
npm install
npm run dev
```

The dev and preview servers serve the sibling data repos at `/data/calibnet/` and `/data/mainnet/`.

## Fetch

```sh
npm run fetch:calibnet    # merges new heights into ../filecoin-message-mix-data-calibration
npm run fetch:mainnet     # merges new heights into ../filecoin-message-mix-data-main
```

- Each run counts the heights since the last run, up to 20 epochs below the head, and merges them
  into the day files. Re-runs never count a height twice.
- The first run starts at the oldest height whose messages the node still has (Lotus nodes keep
  about 1–3 days of messages), and at most 7 days back.
- A run that comes too late, after the node has pruned heights the last run didn't reach, records
  the missing heights in `index.json` as a gap. The site shows gaps as breaks.
- `actor` is the receiver's actor type now. `unknown` means the receiver doesn't exist.
- Method names come from `src/lib/methods.ts`, generated from the builtin-actors sources. Methods
  that aren't in it show as `#<number>`.
- A mainnet run over about 1.8 days of heights takes under 10 seconds.

## Publish

```sh
scripts/publish.sh calibnet
scripts/publish.sh mainnet
```

Fetches, commits and pushes. `NO_PUSH=1` commits without pushing. The script refuses to run if the
data repo has uncommitted changes, or if another publish for it is running.

Run it at least every day or two, so the node still has the heights since the last run.

### On the Lotus host

The runs are automated on the node host with a systemd timer, 4 times a day. Setup steps, deploy keys
and unit files are in [`deploy/`](deploy/README.md).

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `LOTUS_API` | fetch script | calibnet: `http://192.168.50.123:1235/rpc/v1`; mainnet: `http://192.168.50.123:1234/rpc/v1` |
| `DATA_DIR` | publish.sh | the sibling data repo for the network |
| `NO_PUSH` | publish.sh | unset (push) |
| `DATA_DIR_CALIBNET`, `DATA_DIR_MAINNET` | dev/preview server | the two sibling data repos |
| `BASE_PATH` | build | `/` (Pages build: `/filecoin-message-mix/`) |
| `VITE_DATA_BASE_CALIBNET`, `VITE_DATA_BASE_MAINNET` | build | `/data/calibnet/`, `/data/mainnet/` (Pages build: the data repos' Pages URLs) |
