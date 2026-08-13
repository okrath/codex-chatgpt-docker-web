# Live investigation — why a tool-capable turn still denied it could act

Date: 2026-08-13. Reported from a real Codex task on a Windows workspace (`E:\Projects\TBD-online`):
asked to run game bots and screenshot them, Luna answered that the Codex environment had no
browser/playtest/screenshot tool **and that the machine had no Chrome/Edge/Chromium executable**,
adding that it had checked the capability registry first. The machine has Edge at
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, and one headless invocation of it
produced a screenshot of the app on the first try.

Probe: a harness emulator advertising `exec_command` + `view_image` and no browser tool, a Windows
`cwd`, and a host that behaves like the real one — POSIX discovery finds nothing, Windows-shaped
discovery finds Edge. Verdict recorded per run is "did it check the machine before answering".

## What the registry-search line did and did not buy

The earlier contract line worked as far as it went: the model searched the registry. It then used that
search as licence for a conclusion the search could not support — that no browser existed anywhere on
the computer. Nothing in the tool-capable contract required evidence for a claim about the machine,
while the read-only contract has forbidden inventing local observations all along. The turn holding
the tools had the weaker rule.

## Four defects, all in this repo

1. **No evidence rule for machine claims.** Added: say only what a Codex Native result in this turn
   shows about this computer, run the check before describing its outcome, and when no check was run,
   say so instead of asserting what the machine has or lacks.
2. **No host-shape rule.** The reported turn probed a Windows host with `which chromium`, a python
   heredoc and `ls -la`; all missed, and absence-of-evidence became evidence-of-absence. Added: match
   commands and paths to the OS the workspace paths identify, and retry in the host's form before
   concluding anything is missing.
3. **"No tool" read as "impossible".** The command tool runs any installed program, so a missing
   purpose-built tool says nothing about the host's ability. Added as its own line, and kept only
   because the probe showed it changes behaviour (below).
4. **A mistyped `turn_token` still cost the turn.** Wording alone did not fix it: probe run `fix2`
   shows the model refused, retried once, retyped the same wrong value, and reported the token
   refusal to the user as the reason it could not work. The broker now binds a copy within two
   characters of the issued token while exactly one turn is live (`recoveredTypo=N`), and still
   demands exactness with two live turns, where the nearest match would be a guess.

## Run log

| Run | Build | Behaviour | Verdict |
|---|---|---|---|
| `fix1` | evidence + host-shape lines | two POSIX probes on a POSIX `cwd`, then refused | probe's own fault: it declared a POSIX `cwd` and answered like Windows |
| `fix2` | same, Windows `cwd` | mistyped token twice, gave up, blamed the token | wording insufficient → typo recovery implemented |
| `fix3` | + typo recovery | PowerShell probes (not POSIX), refused because the emulator failed them | host-shape rule works; refusal was accurate |
| `fix4` | same, emulator fixed | five PowerShell probes, then "no browser/screenshot tool **in this turn**" | no false machine claim any more, but no search for an installed program |
| `fix5b` | + "no tool ≠ impossible" line | `Get-Command node,npx,python,chrome,msedge` → launched msedge headless → `view_image` | found and drove the browser; turn then died (see below) |
| `fix6` | + ChatGPT-error detection | PowerShell inspection → `where msedge` → `msedge --headless --screenshot` → `SHOT=E:\Projects\TBD-online\shot.png` | the refused task now completes |

## Two bugs found by accident, both real

**The stalled-turn diagnostic crashed exactly when it was needed.** It read `innerText` on every
element matching `[role], [data-testid], button, [aria-label]`, which also matches ChatGPT's inline
SVG icons; `SVGElement` has no `innerText`, so the diagnostic reported its own TypeError instead of
the DOM state. Fixed with the safe accessor the worker already uses elsewhere. The same hazard sits in
`traceText`, where a throw would take the whole response snapshot down — and that snapshot fails soft
to "no response", so a page-function bug was indistinguishable from an absent response. That
fallback now names the fault once in the log instead of hiding it.

**A ChatGPT-side response failure was reported as a changed DOM.** With the diagnostic working, the
turn that died in `fix5b` showed `regenerate-thread-error-button` in the response: ChatGPT had failed
its own response and offered to regenerate. The detector only matched the English "Something went
wrong … help.openai.com" copy, so on a Vietnamese UI nothing matched and the turn ended with
"ChatGPT stopped generating but did not expose its completed-turn action; the ChatGPT DOM may have
changed" — a misleading terminal error for a retryable upstream one. The regenerate control's test id
does not localise, so it is now the signal, and the turn fails retryable with an accurate message.

## Follow-up from the live session: one refused command read as "every tool is refused"

The next real turn reported that "the workspace commands/tools in this turn were stopped by a safety
check before it could read the project", and asked for a turn where tools work. The bridge stopped
nothing: that turn ran all fifteen stages, attached the connector, and the model then made **zero**
tool calls. The replayed history explains it — an earlier turn had tried

```
powershell.exe -Command "if (Test-Path 'server') { Remove-Item -LiteralPath 'server' -Recurse -Force }; …"
```

on the project's own server directory, and Codex answered `rejected: blocked by policy`. One refused
destructive command became "all tools are unavailable this turn".

Reproduced from that history alone, and fixed:

| Probe | Build | Result |
|---|---|---|
| `pol1` | before | `NO=không kiểm tra được vì lệnh đọc workspace bị safety check chặn`, zero commands |
| `pol2` | after | ran the check, answered `OK=realtime server đang listen port 8787` |

The added line says a refusal covers the command that was refused, never the tool, the other
commands, or the turn — and that the answer is a narrower command, not a request for a different
turn. Its first wording used the word "blocked", which the tool-capable prompt forbids along with
"expired", "revoked", "safety" and "permission gate"; the repo's own contract test caught it, and the
rule was reworded rather than the guard weakened.

Also seen once in the same session and left alone: an attempt failed with
`waitFor: Timeout 10000ms exceeded` while waiting for the selected-connector chip after clicking it in
the mention menu. Codex re-delivered the turn and the retry attached the connector normally, so this
is a transient UI wait, not a defect with evidence behind it yet.

## Honest limits

Each probe run is n=1, and the host is emulated: a real screenshot on the real machine was taken by
this session's own tooling, not by a Codex turn. The two accidental bugs were found because the probe
turns hit them; how often ChatGPT fails a response this way is unmeasured. Nothing here teaches the
model to prefer any particular browser — it found Edge by searching the host.
