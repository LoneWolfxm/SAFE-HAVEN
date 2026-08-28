# SAFE-HAVEN Community Governance

This document defines how decisions affecting the SAFE-HAVEN project are
proposed, discussed, voted on, and recorded. Governance is an **off-chain
process** — it does not grant on-chain authority and does not replace the
admin and security controls documented in [CONTRIBUTING.md](CONTRIBUTING.md)
and [SECURITY.md](SECURITY.md).

---

## Table of Contents

1. [Roles](#1-roles)
2. [Decision Types](#2-decision-types)
3. [Proposal Process](#3-proposal-process)
4. [Voting](#4-voting)
5. [Appeal Process](#5-appeal-process)
6. [Transparency and Records](#6-transparency-and-records)
7. [Governance of Governance](#7-governance-of-governance)

---

## 1. Roles

| Role | Description |
|---|---|
| **Contributor** | Anyone who has submitted a merged PR, a resolved issue, or meaningful ongoing participation. Eligible to vote on major proposals. |
| **Maintainer** | Reviews proposals, enforces this process, and applies accepted decisions. Responsible for keeping the repository and community healthy. |
| **Admin** | Manages repository settings, CI secrets, discussion-platform permissions, and role assignments. Admin access does not override the documented decision process. |

### Becoming a maintainer

Maintainer status is extended to contributors who have:

- Merged at least three substantial, independent PRs over at least one month.
- Demonstrated understanding of the contract's security model and the ADR
  process.
- Been proposed by an existing maintainer and not vetoed by any other
  maintainer within 7 days.

Maintainer status may be revoked by a majority maintainer vote if a
maintainer becomes inactive for more than 6 months or violates the code of
conduct.

---

## 2. Decision Types

Not every change needs a formal process. The decision type determines how
much process is required.

| Type | Examples | Who decides | Process |
|---|---|---|---|
| **Trivial** | Typo fixes, dependency patches, routine maintenance, test additions | Any maintainer | No announcement required; single-maintainer merge is acceptable |
| **Minor** | Non-breaking UX changes, documentation updates, non-security implementation improvements | Maintainer team | Announce in the project discussion channel before or alongside the PR; allow 48 hours for objections; proceed if none |
| **Major** | Public contract interface changes, on-chain storage layout changes, security model changes, governance changes, breaking changes of any kind | Community vote | Full proposal process (see below): written proposal, public discussion, timed vote, recorded outcome, appeal period |

Financial-impact decisions (e.g., token allocations, protocol fees,
treasury disbursements) are **outside this framework** and require a
separately approved policy that does not yet exist. Do not use this process
for financial decisions.

### When in doubt

If you are unsure whether something is minor or major, treat it as major.
The extra overhead of a written proposal is small compared to the cost of
shipping a decision the community didn't agree to.

---

## 3. Proposal Process

### Step 1 — Draft

1. Copy [docs/proposals/TEMPLATE.md](docs/proposals/TEMPLATE.md).
2. Assign a short title and today's date.
3. Fill in the **Summary**, **Motivation and context**, **Proposed decision**,
   and **Alternatives considered** sections.
4. Set `Status: Draft` and `Type: Major`.
5. Publish the draft in the project's public discussion channel (see
   [Voting Platform](#voting-platform) below) and open a GitHub Discussion
   or issue thread linking to it.

### Step 2 — Discussion

The draft is open for questions, counterarguments, and revisions. Keep this
phase open for at least **5 calendar days** before scheduling a vote. For
complex or security-sensitive proposals, allow more time.

**Material changes to the proposal** (changes to the decision itself, not
just wording) during the discussion phase require restarting the discussion
clock. Post a clear notice ("This proposal has been materially revised; the
5-day discussion period restarts from today") so participants can re-evaluate.

A proposal may be withdrawn at any time during the discussion phase by the
author or by maintainer consensus.

### Step 3 — Vote scheduled

Before opening the vote:

1. Mark the proposal `Status: Voting scheduled`.
2. Post the opening and closing timestamps (ISO 8601, UTC) and the
   eligibility rule in the proposal document.
3. Announce the vote in the discussion channel with at least 24 hours notice
   before voting opens.

The proposal author (or, if the author is unavailable, a maintainer) is
responsible for this step.

### Step 4 — Vote

Eligible participants cast their vote as **For**, **Against**, or
**Abstain**. See [Section 4](#4-voting) for the rules.

### Step 5 — Result

Within 48 hours of the vote closing:

1. Count the votes and verify quorum.
2. Update the proposal with the result, voter list or platform link, quorum
   calculation, tally, and the implementation owner.
3. Set `Status: Approved` or `Status: Rejected`.
4. Announce the result in the discussion channel.

### Step 6 — Appeal

Allow a **7-day appeal period** after the result is announced before
implementing the decision. See [Section 5](#5-appeal-process).

### Step 7 — Implementation

After the appeal period closes:

1. The implementation owner opens a PR implementing the decision.
2. For architectural changes, the PR must include an ADR in
   [docs/adr/](docs/adr/README.md).
3. The proposal document is updated with a link to the implementation PR and
   the final ADR.
4. Set `Status: Implemented`.

---

## 4. Voting

### Voting platform

The project should use a public, searchable, and permanent discussion
platform. Suitable options include:

- **GitHub Discussions** — a dedicated "Governance" category in the
  repository.
- **Discourse** — a hosted forum instance.

Until a platform is selected and announced by the maintainer team, proposals
and votes are recorded in the repository's GitHub Discussions or as pinned
issues. **No platform is considered configured merely because it is named
here.** Maintainers must explicitly set up and announce the platform before
the first vote.

### Eligibility

A participant is eligible to vote on a major proposal if, at the time the
vote opens, they have had **at least one merged PR or one resolved issue in
the previous 12 months**, or are a listed maintainer.

The maintainer team is responsible for:
- Publishing the eligibility rule in each proposal before the vote opens.
- Rejecting duplicate or sockpuppet accounts.
- Resolving eligibility disputes within 48 hours of a challenge.

### Voting window

The default voting window is **7 calendar days**. For proposals that are
complex, security-sensitive, or have generated significant discussion, a
maintainer may extend the window to **14 calendar days**. Extensions must
be announced before the original closing time.

The voting window cannot be shortened after it opens.

### Vote rules

| Rule | Value |
|---|---|
| Quorum | The greater of: **3 eligible voters** OR **25% of eligible participants active in the past 12 months** |
| Majority | Simple majority of valid votes cast, excluding abstentions |
| Tie | A tied vote **fails** |
| Abstentions | Count toward quorum but not toward the majority calculation |
| Vote changes | Allowed until the voting window closes |
| Anonymous votes | Not accepted — each vote must be attributable to an eligible participant |

If the project cannot reliably measure the number of active eligible
participants, the minimum quorum of 3 voters applies and this limitation must
be explicitly noted in the proposal record.

### What happens if quorum is not met?

If quorum is not met when the voting window closes:

1. Announce the quorum failure in the discussion channel.
2. The proposal may be resubmitted after at least **14 days**, with renewed
   discussion and outreach to eligible voters.
3. A proposal that fails quorum twice may be re-categorized as Minor (if
   maintainers agree the impact was overstated) or withdrawn.

---

## 5. Appeal Process

After a vote result is announced, there is a **7-day appeal period** before
implementation begins.

### Valid grounds for appeal

An appeal must identify one or more of:

- **Process error**: the voting process was not followed (wrong window, wrong
  eligibility rule, material changes after votes were cast, etc.).
- **New material evidence**: information that was not available during the
  vote and that would plausibly have changed the outcome.
- **Conflict of interest**: a voter or proposal author had an undisclosed
  interest that should have disqualified their participation.

**Disagreement with the outcome is not a valid ground for appeal.** The
appeal mechanism exists to correct process failures, not to re-litigate
close votes.

### Appeal procedure

1. File the appeal as a comment in the original proposal thread within the
   7-day window. State the specific ground and supporting evidence.
2. A maintainer (other than any named in the conflict-of-interest claim, if
   applicable) reviews the appeal and publishes a decision within 5 days.
3. If the appeal is upheld:
   - Implementation is paused.
   - The proposal returns to the **Discussion** phase (or the vote is
     re-run, depending on the nature of the error).
4. If the appeal is rejected, implementation proceeds.

The appeal decision is final. There is no second appeal.

---

## 6. Transparency and Records

All proposals, votes, results, appeals, and implementation links must remain
publicly accessible indefinitely. Deleting or obscuring governance records is
a violation of this framework.

### Major technical decisions

Major technical decisions must also have an Architecture Decision Record in
[docs/adr/](docs/adr/README.md). The ADR documents the technical reasoning;
the proposal document records the community decision. Both are required.

### Proposal archive

Completed proposals (Implemented, Rejected, or Withdrawn) should be kept in
`docs/proposals/` as a historical record. File naming convention:

```
docs/proposals/YYYY-MM-DD-short-title.md
```

### Disclosure obligations

Participants with a financial or organizational conflict of interest in a
proposal must disclose it at the start of the discussion phase. Failure to
disclose is grounds for voiding a vote under the appeal process.

---

## 7. Governance of Governance

Changes to this document — including changes to voting rules, quorum,
eligibility, or the proposal process itself — must follow the **Major**
decision process defined in this document.

This ensures that governance rules cannot be changed unilaterally by
maintainers without community input.

The maintainer team should review this document at least annually and propose
updates as the project's scale and needs evolve.
