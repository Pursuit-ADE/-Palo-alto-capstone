# Distribution lists for alerts (design only)

PRD L8, plan item 13. Alex asked on Oct 24 whether alerts should go to distribution lists. **Nothing here is built.**
We build it only if he says yes; until then an alert goes to one person at a time, as it does today.

## The rule that doesn't change

An alert reaches a person only if that person may see the account, holds a role in the rule's audience, is an active
employee, and wants the alert. A list must never become a way around that. So a list is only a shortcut for
subscribing several people at once. It is never a destination.

## How it would work

1. **A list is a named set of people, kept in the repo.** For example `alerts/lists/east-account-team.json`: an id, a
   name, an owner, a version and member user ids. It is changed through a reviewed pull request, like the alert rules,
   and has no runtime editing. A real rollout would read the members from an Active Directory group behind the same
   interface as `EmployeeDirectory`.
2. **A subscription can name a list instead of a person.** `alert_subscriptions` gains a nullable `list_id`. Each
   member still gets their own frequency, channel and quiet hours from their own preferences, and can opt out alone.
3. **The engine expands the list into members when it routes an event.** Each member then goes through the existing
   per-person path in `runAlerts`, unchanged:
   - their role must be in the rule's audience;
   - they must be on the account team (`canSeeAccount`);
   - they must be an active employee (`EmployeeDirectory`, #55).

   A member who fails any check is skipped, and the others still get the alert.
4. **One alert per person.** The dedupe key stays (rule, user, event), so someone on two lists, or on a list and
   subscribed alone, gets one alert, not two.
5. **The send-time re-check covers the list too.** `stillEligible` also checks that the person is still on the list
   (or still subscribed alone). Someone removed from a list stops getting queued digests and retries, the same way a
   person who leaves does today.
6. **Delivery goes to each person's own channel.** That means their own Slack webhook or email address. Never a
   shared mailbox or group channel, because a shared address would reach people the engine never checked.
7. **The audit trail shows why someone got an alert.** Each `alert_deliveries` row records the list id (or none) that
   put the person in the audience.

## What it doesn't do

- **No posting to a shared Slack channel or a group email address.** If Alex needs that, it is a different feature: a
  channel whose members are all checked against the account, which we would design with him.
- **No list inside a list.**
- **No list created from the copilot's answers.**

## If we build it

- About one week for one person:
  - a migration for `list_id`;
  - the list files and their schema check, like `alerts/rules/`;
  - expansion in `runAlerts`;
  - the list check in `stillEligible`;
  - a short section in `alerts/README.md`.
- Tests:
  - a list member off the account team gets nothing, and the other members still get the alert;
  - an inactive member gets nothing;
  - a person on two lists gets one alert;
  - someone removed from a list loses their queued digest;
  - nothing is sent to an address that isn't a member's own.

## Questions for Alex

1. Does his team need lists for the demo, or is one person per alert enough for now?
2. If lists: are they the account team for an account (which we already have), or other groups, such as a regional
   leadership list?
3. Is a shared channel or mailbox ever acceptable, and if so, who owns checking its membership?
