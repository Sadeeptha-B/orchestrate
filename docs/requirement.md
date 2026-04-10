## Iteration 1:

I have often found that on a new day, it is essential to contextualize your tasks. Typical task manager programs, while they maintain lists, do not solve the extra friction for contextualization in terms of the new day, which requires going through the todolist and getting a holistic overview of it. What I want to build is mainly a web app that walks you through this contextualization process.

I plan to achieve this through a number of steps

1. The app nudges the user to write down his main priorities for the day; the main tasks that he has

2. Then he invites the user to compare his tasks against his todolist and then if necessary, make the todolist consistent, which further contextualizes his tasks. He is invited to create calendar events, and break down the tasks accordingly

3. Then he is asked to categorize the tasks in terms of main tasks and background tasks. Main tasks are tasks that are the main running threads in the day; eg: implementing a specific feature in code. Background tasks are usually habit based tasks that recur across days. These are tasks like reading, doing c# coding exercises, and so on

4. We can assume that the user works in four time slots, 
Early morning session -> 6am - 8am
Morning Sesion -> 9am - 1pm
Afternoon Session -> 2:30pm - 6:30pm
Night Session -> 8:30pm - 11pm

Based on the time in which starts, the app should loop through the sessions left and tell the user to schedule main tasks within sessions

5. Then the app should invite the user to schedule background tasks accordingly within the day based on his main task allocation

6. Refer to [Music Routine](./music_routine.md) that decides on music for the user based on the type of work. The app should then prompt the user to start the "Start work music"

7. Then the app should show all the different playlists detailed in [Music Routine](./music_routine.md)  in a format so that it is always visible to the user.

8. Hour by hour the app should prompt the user and ask how his day is going and remind him to recontextualize if necessary. It would also ask him the type of work he's doing and to switch playlists if necessary

The main goal of this proposed app is contextualization and nudging the user towards his tasks, countering task and time blindness. This version is specific to the author's needs. The main todolist and calendar is separate from this app, in external software, no api integration with these software is needed at this stage. This companion app will deal with the tasks that the user provides in the first step, and nudge the user to keep his external todolist and calendar consistent in the second step. Save the app's data in local storage.


## Iteration 2:
