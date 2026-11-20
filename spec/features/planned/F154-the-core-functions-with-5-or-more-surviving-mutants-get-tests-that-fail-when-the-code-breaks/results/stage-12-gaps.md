| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/notices/renderers.ts | noticeRenderers.urgent.telegram.full | 12 | 3 |
| packages/core/src/digest/weekly.ts | evidenceItems | 12 | 1 |
| packages/core/src/digest/notices.ts | renderActionFailedNotice | 12 | 0 |
| packages/core/src/notices/render.ts | renderNotice | 10 | 10 |
| packages/core/src/digest/local-time.ts | localInstants | 8 | 8 |
| packages/core/src/digest/weekly.ts | autoItems | 7 | 0 |
| packages/core/src/digest/weekly.ts | renderWeeklyReport | 7 | 0 |
| packages/core/src/digest/local-time.ts | lateMin | 6 | 5 |
| packages/core/src/notices/views.ts | trustUrl | 6 | 2 |
| packages/core/src/digest/notices.ts | renderUrgentNotice | 6 | 1 |
| packages/core/src/digest/local-time.ts | quietEnd | 3 | 3 |
| packages/core/src/digest/local-time.ts | isQuietTime | 2 | 1 |
| packages/core/src/digest/notices.ts | renderSyncStaleNotice | 2 | 0 |
| packages/core/src/digest/local-time.ts | startOfLocalDay | 1 | 1 |
| packages/core/src/digest/local-time.ts | text | 1 | 1 |
| packages/core/src/digest/notices.ts | renderSendHeldNotice | 1 | 0 |

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/digest/local-time.test.ts | src/digest/local-time.test.ts > a quiet window that does not wrap midnight > lateMin takes the window off a range that spans it | 1 |
| packages/core/src/digest/local-time.test.ts | src/digest/local-time.test.ts > a quiet window that does not wrap midnight > the quiet time starts at the start time itself | 1 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > other notices > sync late with a last good sync prints its clock, in three lines | 2 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderActionFailedNotice > an original move after bad_payload does not name the folder in its first line | 2 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderActionFailedNotice > the last line of a create_draft with reverse %s | 5 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderActionFailedNotice > the last line of a flag with reverse %s [0] | 5 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderActionFailedNotice > the last line of a flag with reverse %s [1] | 5 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderActionFailedNotice > the last line of a mark_read with reverse %s [0] | 5 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderActionFailedNotice > the last line of a mark_read with reverse %s [1] | 5 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderSendHeldNotice > a follow-up hold is two lines, with the panel link as a third line only when set | 1 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderUrgentNotice > a delegable mail has the Delegate button in the first row | 4 |
| packages/core/src/digest/notices.test.ts | src/digest/notices.test.ts > renderUrgentNotice > with no AI text the notice has no empty line | 1 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the evidence items of the weekly report > a proof decision of none reads proof none | 2 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the evidence items of the weekly report > a trip that is not tripped does not pause the category, whatever its reason | 2 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the evidence items of the weekly report > a tripped row with no reason does not hide a later tripped row that has one | 2 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the evidence items of the weekly report > the check outcome fail reads check fail | 2 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the evidence items of the weekly report > the check outcome unknown reads check no result | 1 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the evidence items of the weekly report > with several auto rows the row with the most kept labels gives the proof and the check; a tie keeps the first | 6 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > auto item: 29 kept labels: too few | 1 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > auto item: 30 kept labels and no precision: too few | 2 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > auto item: 30 kept labels, a precision and a lower bound: the suffix | 1 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > auto item: 30 kept labels, a precision and no lower bound: no suffix | 3 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > auto item: a category with no auto row has no item | 1 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > the mail line: important mail and nothing triaged | 3 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > the mail line: no important mail but mail triaged | 3 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > the review sample line shows from one labelled mail | 1 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > the shadow mode line: nothing handled and none would be | 4 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > the shadow mode line: some mail handled and some would be | 3 |
| packages/core/src/digest/weekly.test.ts | src/digest/weekly.test.ts > the mail line and the auto items of the weekly report > with two auto rows of one category the row with more kept labels stands; a tie keeps the first | 5 |
| packages/core/src/notices/render.test.ts | src/notices/render.test.ts > the urgent notice on Telegram, full detail > a view with every optional field renders each line and both extra buttons | 12 |
| packages/core/src/notices/render.test.ts | src/notices/render.test.ts > the urgent notice on Telegram, the stay folder > a view with no action to show names the folder the mail stays in | 1 |
| packages/core/src/notices/trust.test.ts | src/notices/trust.test.ts > the links of a trust notice (TG1) > the report link schema refuses 36 characters that are not a uuid | 1 |
| packages/core/src/notices/trust.test.ts | src/notices/trust.test.ts > the links of a trust notice (TG1) > the settings link schema refuses a password with no user name | 1 |
| packages/core/src/notices/trust.test.ts | src/notices/trust.test.ts > the links of a trust notice (TG1) > the settings link schema refuses text that passes the pattern but is no URL | 2 |

0 new cases kill no before-survivor
