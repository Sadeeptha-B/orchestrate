## Iteration 1:

I have often found that on a new day, it is essential to contextualize your tasks. Typical task manager programs, while they maintain lists, do not solve the extra friction for contextualization in terms of the new day, which requires going through the todolist and getting a holistic overview of it. What I want to build is mainly a web app that walks you through this contextualization process.

I plan to achieve this through a number of steps

1. The app nudges the user to write down his main priorities for the day; the main tasks that he has

2. Then he invites the user to compare his tasks against his todolist and then if necessary, make the todolist consistent, which further contextualizes his tasks. He is invited to create calendar events, and break down the tasks accordingly

3. Then he is asked to categorize the tasks in terms of main tasks and background tasks. Main tasks are tasks that are the main running threads in the day; eg: implementing a specific feature in code. Background tasks are usually habit based tasks that recur across days. These are tasks like reading, doing c# coding exercises, and so on

4. We can assume that the user works in four time slots, 
- Early morning session -> **6am - 8am**
- Morning Sesion -> **9am - 1pm**
- Afternoon Session -> **2:30pm - 6:30pm**
- Night Session -> **8:30pm - 11pm**

    Based on the time in which starts, the app should loop through the sessions left and tell the user to schedule main tasks within sessions

5. Then the app should invite the user to schedule background tasks accordingly within the day based on his main task allocation

6. Refer to [Music Routine](./music_routine.md) that decides on music for the user based on the type of work. The app should then prompt the user to start the "Start work music"

7. Then the app should show all the different playlists detailed in [Music Routine](./music_routine.md)  in a format so that it is always visible to the user.

8. Hour by hour the app should prompt the user and ask how his day is going and remind him to recontextualize if necessary. It would also ask him the type of work he's doing and to switch playlists if necessary

The main goal of this proposed app is contextualization and nudging the user towards his tasks, countering task and time blindness. This version is specific to the author's needs. The main todolist and calendar is separate from this app, in external software, no api integration with these software is needed at this stage. This companion app will deal with the tasks that the user provides in the first step, and nudge the user to keep his external todolist and calendar consistent in the second step. Save the app's data in local storage.


## Iteration 2:

In the second iteration, we are changing the app to be more sophisticated. The current "tasks" that we have in the app are to be understood as intentions for the day.

Usually, todo lists tend to be "epics", a pain point we are solving is that todo lists tend to be epics, and when starting a day, we don't tend to think in terms of epics, but in terms of "intentions", of specific goals for the day. The second page should focus on mapping intentions to specific todolists. 

I currently manage my tasks with [Trevor AI](https://app.trevorai.com/app/), we should add a sizeable iframe of this app in the second step. So that it is visible for mapping. In the future, we may migrate to our own inbuilt todolist and calendar management for setup, but for now, this is a preliminary approach. Then, you should loop through each intention and then prompt the user to break down tasks, which he would then do in the corresponding iframe. 

Then the next main tasks section should focus on the user scheduling the tasks into time, in this view also, we will have an iframe, where the user will schedule the tasks he broke down into specific slots, the intentions too ideally should be scheduled, but the way we do this, I need to still decide, you are free to decide on a suitable approach for the time being. 

The background tasks should be nudges/habits. So habits would typically be background tasks, but not all background tasks would be habits. So, what might be a good strategy to schedule the background tasks in? I was thinking being flexible, and frequently nudging the user that these tasks exist, and also allowing a single background task to be scheduled at multiple slots can help. 

You are free to redesign the flow in light of these new requirements, the dashboard should also contain an iframe of the tasks along with the current intention based setup. You are free to make suitable design decisions in the initial iteration of this implementation. 

### Iteration 2.1 — Todoist + Google Calendar Integration

The Trevor AI iframe approach proved non-functional: Trevor AI sets `X-Frame-Options: DENY` and modern browsers block cross-origin cookies (`SameSite` defaults), preventing embedded login.

**Pivot to Option B:**
- **Todoist REST API (v2)**: Direct API integration using a personal API token (no OAuth, no backend). Users paste their token from Todoist Settings → Integrations → Developer. Token is encrypted client-side using AES-GCM via the Web Crypto API before being stored in localStorage.
- **Google Calendar embed**: Official embeddable iframe (`https://calendar.google.com/calendar/embed?src={calendarId}&mode=week`). Read-only, works when the user is logged into Google. User-configurable calendar ID.
- **Data model**: Orchestrate owns the intention-level view. Todoist owns the task-level view. Google Calendar provides time-context. The user's existing Todoist↔Google Calendar sync keeps the latter two in sync automatically.

See [plan_v3.md](./plan_v3.md) for the full implementation plan.
