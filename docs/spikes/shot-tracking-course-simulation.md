# On-course interaction simulation

This is a software simulation using public course geometry and synthetic positions, not an outdoor GPS accuracy test. The changes below apply to the actual Play screen and round model. The separate terrain/range prototype remains a feasibility spike.

## Tested scenarios

| Situation | Result |
| --- | --- |
| Start at the tee, hit, walk, start the next shot | The next start closes the previous shot at the next ball position. |
| Accidentally double-tap Start shot | Rapid repeated shot taps are ignored with feedback. |
| Pick the wrong club, hit, walk away, then Undo | The removed stroke's position, capture time, accuracy, and club become a saved correction. HUD yardage uses that position. |
| Select a different club and Save correction | Both the replacement origin and preceding shot's endpoint use the saved ball position. Current GPS cannot move the correction. |
| Reopen the play screen while correcting | Correction data is stored with the round and survives serialization and remount. |
| Undo an extra stroke that should simply disappear | Use live GPS discards the correction and resumes current-position tracking. |
| Start the first putt, walk closer, Undo, and correct it | The first putt's saved position closes the approach; the new GPS position does not overwrite it. |
| Record additional putts, then Undo and correct one | The approach endpoint remains unchanged. |
| GPS drifts outside the green after putting starts | Putter stays selected until a different club is explicitly selected. |
| Accidentally double-tap Start putt | Rapid repeated putt taps are ignored; a later intentional putt counts normally. |
| GPS is denied | Putt counting and penalty tools remain usable; missing positions are not invented. |
| Load an older round without putt-position metadata | The round still loads and count Undo works; a missing historical position cannot be recovered. |

## Minimal next improvements identified

1. **Fresh GPS after unlocking:** suppress confident live yardage/suggestions until a recent acquisition arrives. The terrain spike already explores this; the production GPS hook still needs that integration and outdoor testing.
2. **Correct a forgotten stroke after the fact:** allow placing its start on the map, label it manual, and exclude uncertain distances from learned yardages. A missed position cannot be reconstructed from GPS collected only afterward.
3. **Direct club correction on the last stroke:** a dedicated edit action could retain its position without removing/re-adding a stroke. Keep this secondary so the main screen stays focused on starting the next shot.

The 1.2-second repeat-tap guard is an interaction safeguard, not automatic shot detection. Saved corrections intentionally retain their capture quality; aging during a walk does not turn an old saved stroke into a current GPS fix. The blue map marker remains current GPS, and a separate Saved stroke marker identifies the correction origin. Finishing a hole discards an unresolved correction.
