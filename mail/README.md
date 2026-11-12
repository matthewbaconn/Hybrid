Member update emails. The API checks `outbox.json` every 15 minutes and sends it once to every member
(except people who unsubscribed) after `send_after`. A new email needs a new `id`. Updates older than 7 days are ignored.
