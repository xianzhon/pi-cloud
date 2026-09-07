# Model window kickoff

The **Settings > Model window kickoff** page can start a provider quota window without creating a chat session.

1. Add a kickoff and select an agent profile and model.
2. Set the window duration and safety buffer. The default is five hours plus 60 seconds.
3. Set **Next kickoff** to delay the first or next request to a specific time.
4. Optionally configure a WeCom group-bot key and select that notification channel.

At the scheduled time, Pi Cloud sends only the configured probe prompt directly to the model, with no tools, skills, memory, or persisted session. After success, the next time is calculated from the successful request time. Failures are displayed in Settings and retried after one hour.

The scheduler checks every ten minutes. If Pi Cloud restarts after a kickoff is overdue, it sends one request after startup rather than replaying missed intervals.

The WeCom bot key is stored in Pi Cloud's access-restricted application database and is never returned by the API.
