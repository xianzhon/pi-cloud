# Model window kickoff

The **Settings > Model window kickoff** page can start a provider quota window automatically.

1. Add a kickoff and select an agent profile and model.
2. Set the project directory used by the kickoff session. It must exist and be within the configured allowed roots.
3. Set the window duration and safety buffer. The default is five hours plus 60 seconds.
4. Set **Next kickoff** to delay the first or next request to a specific time.
5. Optionally configure a WeCom group-bot key and select that notification channel.

At the scheduled time, Pi Cloud sends the configured probe prompt, which defaults to `Ping`, through a named persistent Pi session in the selected project directory. Memory is disabled for this session. After success, the next time is calculated from the successful request time. Failures are displayed in Settings and retried after one hour.

The scheduler checks every minute. If Pi Cloud restarts after a kickoff is overdue, it sends one request after startup rather than replaying missed intervals.

The WeCom bot key is stored in Pi Cloud's access-restricted application database and is never returned by the API.
