# Explicit shot tracking

Choose a club (its configured stock yardage is shown), tap **Track shot**, then
tap **Save here** at the ball. The saved start survives reloads. Tracking does
not count a stroke until it is saved. Changing the club while tracking changes
only that pending shot; beginning another shot never moves a previous finish.

**Missed shot?** appears on the map when fresh, accurate, settled GPS
is sufficiently far from the last saved finish, or the selected tee for the
first shot. The suggested club is the closest enabled stock yardage. Tapping
opens the same hole editor used for saved shots and finished rounds. Change the
club with the left button, adjust Start/Finish directly on the map, then choose
**Save changes**. The suggestion is a draft until then. Walking can trigger a
suggestion: it is never accepted automatically. For several missed shots, open
**All shots**, choose that shot's Split action, then tap remembered ball stops in
order. Every segment gets its own suggested club from stock yardage. Tap
**Review shots**, check the shots, then **Save changes**. A gap beyond
normal single-shot range opens this editor directly instead of adding one long
drive. GPS cannot infer the number of swings or recover intermediate stops.

GPS never switches to putting automatically. Save the tracked chip using
**Save here**, then choose **Putter** in the club sheet to enter putts and finish
the hole in the same editor. Choosing Putter never saves a pending chip. Putts
accept whole counts from 0 to 999.
Finishing a hole changes its score and completion state without moving endpoints
or inventing a finish at the estimated pin.

Tap a saved shot's line or label to edit its start and finish. Drag a handle,
select Start/Finish and tap the map, or use arrow keys for one-yard adjustments.
Use a shot's map label or the scorecard to open the editor. **All shots** lets
you insert a missing shot, change putts/penalties/adjustments, or choose an unplaced
shot. Delete requires a second tap and changes stay in a draft until saved.
Scorecard cells open played holes for editing; finished rounds open Edit hole
directly, without a separate read-only review. Edits preserve neighboring shots, penalties, completion,
and the hole currently being played. An observed change to the same hole blocks
a stale editor save. Sync retains the existing per-round last-write-wins behavior.

If a score adjustment already represents the newly inserted stroke, choose
the editor's option to replace one positive score adjustment with that shot.
Unknown GPS endpoints stay unplaced and can be corrected later. Recovered,
manually edited, short, and uncertain shots do not train club distances.

Recovery requires GPS no older than 8 seconds, accuracy at most 8 meters,
and a position settled for at least 2 seconds. Displacement must exceed
20 yards and twice the combined endpoint uncertainty, and remain within
1.35 times the longest configured stock yardage. A last finish with unknown
or poor accuracy is offered through manual editing instead. Suspension,
permission errors, and expired fixes clear the usable position.

Legacy rounds keep their saved geometry. New fields are optional JSON fields
in the existing local storage and round sync schema; no database migration is
required. Satellite imagery still depends on previously cached tiles offline.
The main map has no long-press action or floating tools menu. Hole navigation
has separate previous/next touch areas and opens the scorecard from its center;
round actions live in that scorecard sheet. The club picker is a dismissible
bottom sheet with stock yardages, a selected-state check, and one-tap selection.
Map credits remain visible as text, without a separate information icon.
The top navigation stays 44 pixels high with separate arrow touch targets. The
tracking row has exactly two buttons: club and Track shot / Save here. Distance
appears inline (for example, Save here · 96 yd), without a separate message or
Save + putts action. Editing a selected shot uses the same club / Save changes
row, with draggable map handles and an All shots label for the hole overview.

Validation covers pending-shot reloads, duplicate taps, missing/stale/future GPS,
resume and permission errors, recovered-shot idempotence, six-plus putts, chips,
editing completed holes and rounds, insert/delete ordering, independent endpoints,
legacy imports, and stale-editor conflict rejection. Phone GPS accuracy and
battery behavior still need field validation during a real round.
