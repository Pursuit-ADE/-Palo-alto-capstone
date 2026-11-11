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
2. **A list subscribes its members; it doesn't replace them.** `alert_subscriptions` keeps its key (user plus rule).
   Subscribing a list to a rule writes one ordinary row per member, with a nullable `list_id` that records where the
   row came from. A member who already has their own row for that rule keeps it and its preferences.
3. **Preferences.** A row a list creates starts with the safest defaults: the in-app inbox, real time, no quiet hours
   and no critical bypass. It never starts on Slack or email, a channel the person didn't choose. The member can change
   it like any other subscription.
4. **Opting out is a stored row, not a file edit.** A member who opts out keeps their row with an `opted_out_at` time.
   Re-expanding the list skips them, and `stillEligible` treats an opted-out row like no subscription. That holds even
   while the list file still names them. Removing someone from the file deletes only the rows the list created for them.
5. **The engine routes each member like any other subscriber.** Each member then goes through the existing per-person
   path in `runAlerts`, unchanged:
   - their role must be in the rule's audience;
   - they must be on the account team (`canSeeAccount`);
   - they must be an active employee (`EmployeeDirectory`, #55).

   A member who fails any check is skipped, and the others still get the alert.
6. **One alert per person.** The dedupe key stays (rule, user, event), so someone on two lists, or on a list and
   subscribed alone, gets one alert, not two.
7. **The send-time re-check covers the list too.** `stillEligible` also checks that a list-created row's list still
   names the person, and that the row isn't opted out. Someone removed from a list stops getting queued digests and
   retries. The employee check stays where it is, in `sendVerdict`, so a person who leaves is still recorded as
   `suppressed_inactive`, not only dropped as "not on the list".
8. **Delivery goes to each person's own channel.** That means their own Slack webhook or email address. A person's
   alert never goes to a shared mailbox or group channel, because a shared address would reach people the engine never
   checked. The team heads-up below is the one shared post, and it carries no one's alert.
9. **The audit trail shows why someone got an alert.** Each `alert_deliveries` row records the list id (or none) that
   put the person in the audience.

## What it doesn't do

- **No person's alert in a shared Slack channel or a group email address.** If Alex needs that, it is a different
  feature: a channel whose members are all checked against the account, which we would design with him.
- **No list inside a list.**
- **No list created from the copilot's answers.**

## Team heads-up (the one shared post, #125)

With `SLACK_TEAM_WEBHOOKS` set, a team's own Slack channel gets one short note per team-wide event (a support case or
low usage): the account and the event, never who was alerted and never their alert text. The engine's per-person checks
(`stillEligible`, the employee check) can't cover a channel, so the rule is different and is the operator's:

- **Who owns it:** whoever runs the alerts service sets the map (manager id to that team's webhook) in its environment.
  It is never stored in the repository.
- **Membership:** that person keeps each channel to the members of that manager's team, who can already see the team's
  accounts in the copilot, and removes people when they leave the team. A channel that can't be kept that way must not be
  in the map.
- **Unset** (the default), nothing is posted to any shared channel.

## If we build it

- About one week for one person:
  - a migration for `list_id` and `opted_out_at` on subscriptions, and `list_id` on deliveries;
  - the list files and their schema check, like `alerts/rules/`;
  - expanding a list into subscription rows when it is subscribed, and again when its file changes;
  - the list check in `stillEligible`;
  - a short section in `alerts/README.md`.
- Tests:
  - a list member off the account team gets nothing, and the other members still get the alert;
  - an inactive member gets nothing;
  - a person on two lists gets one alert;
  - someone removed from a list loses their queued digest;
  - an opted-out member gets nothing even though the list still names them;
  - a row a list creates starts on the inbox, never on Slack or email;
  - nothing is sent to an address that isn't a member's own.

## Questions for Alex

1. Does his team need lists for the demo, or is one person per alert enough for now?
2. If lists: are they the account team for an account (which we already have), or other groups, such as a regional
   leadership list?
3. Is a shared channel or mailbox ever acceptable, and if so, who owns checking its membership?
