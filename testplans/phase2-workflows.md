# Phase 2 workflow guides

**How to test each feature, step by step**

The companion to the *Phase 2 test checklist*. That one lists what has to be true. This one tells you
how to get there, in order, with what you should see at each step and what it means.

Written the way a CA would actually work: pick a client, pick a month, and follow the job through.

---

## Before you begin

### Signing in

| | |
|---|---|
| Dev app | `https://devapp.auditglide.com` |
| Ops admin | `https://admin.auditglide.com` |

Use a login on **Selvaraj & Co Auditors** for most of this. It has ten clients with real returns
already stored, so most screens have something to show without waiting on the portal.

### The one idea behind all of it

Every screen in Phase 2 reads figures from the GST portal, and every one of them has to be honest
about three different situations:

1. **We read it.** Show the figure.
2. **We read it and there was nothing there.** Say nil, or no entries.
3. **We could not read it.** Say so, and show a dash.

The third one is where the bugs live. A screen that shows `0` for something nobody looked at is
telling a CA their client is fine. Watch for that everywhere.

### Two routes, two different waits

- **Selvaraj & Co Auditors** reads through the office PC. Asking for data queues a job and the answer
  comes back **about a minute later**, and only while that PC is on.
- **ConnectorTest** and **SOTOWORX** read through the paid API. That needs the client to read out a
  **one-time password**, and then data comes back straight away.

You want to see both. The wording on screen should never tell you which is which, and that is
deliberate: a CA only needs to know whether something is needed from them right now.

### Keep the Network tab open

For several of these workflows you are counting requests, not reading figures. In Chrome: right click
the page, **Inspect**, then the **Network** tab, then click **Fetch/XHR**. Leave it open.

---

## Workflow 1: the firm's ledger position, first thing in the morning

*What a CA does before starting the month's filing: find out which clients cannot file.*

**Step 1.** Left menu, under FILING, click **GST Ledgers**.

**Step 2.** Look at the five counters across the top before anything else.

> **What you should see.** Five boxes: 3B will be blocked, ITC blocked Rule 86A, Negative liability to
> use, Cash lying in ledgers, Could not read. A counter that is zero is plain black. A counter that is
> not zero is coloured.
>
> **What it means.** The first one is the only one that stops work. Since a GST rule change in December
> 2025, a negative balance on either of two statements blocks the GSTR-3B outright.

**Step 3.** Look at the order of the rows.

> The list is sorted by **what stops work first**, not alphabetically. Clients who cannot file are at
> the top, then credit blocked, then demands, then negative liability to use, then the ones we could
> not read, then unused cash, then everything else.
>
> A firm with fifty clients needs to know which two cannot file, not to read fifty rows.

**Step 4.** Find a row where a figure is missing.

> **What you should see.** A grey dash, and the flag reading **Could not read**, and under it the names
> of the ledgers that are missing.
>
> **What must never happen.** A `0` in that cell, or the flag reading **Clear**. Telling a firm a client
> is fine, about a client we only half looked at, is the one mistake this screen must never make. If you
> see it, stop and report it.

**Step 5.** Read the **Before the next 3B** panel on the right.

> Each client named there should say what to **do**, not only what is wrong. "RCM statement has gone
> below nil. Pay the extra RCM in 3.1(d), or claim that much less in 4A(2)/(3)." A panel that only says
> "3B will be blocked" has handed the CA the work rather than the answer.

**Step 6.** Click a client name, either in the table or in that panel.

> It opens that client's ledgers. Workflow 2 carries on from here.

**On dev today:** no ledger has ever been pulled, so expect every row to read "Could not read" and the
counters to show 0, 0, 0, ₹0 and 54. That is the correct display of an honest nothing. To see real
figures you need workflow 3.

---

## Workflow 2: reading one client's six ledgers

*What a CA does when a client is flagged: find out which statement is the problem.*

**Step 1.** From the list, click a client. Or open GST Ledgers and pick one.

**Step 2.** Look at the strip of six tiles before the tabs.

> **What you should see.** Cash ledger, Credit ledger, Liability register, Credit reversal & re-claimed,
> RCM liability / ITC, Negative liability. Each with a closing balance.
>
> **What it means.** These are the four figures a GSTR-3B actually turns on. The tabs below are for
> tracing where a figure came from, not for finding out what it is.
>
> A tile we could not read shows a grey dash and the words "could not read". A tile that was read and
> had nothing says "no entries". **Those are different and the screen must show both differently.**

**Step 3.** Look at the box above the strip.

> Three possibilities, and only one appears at a time:
>
> - **Red box:** "This client cannot file their GSTR-3B yet", and the reasons listed.
> - **Grey box:** "We cannot tell whether this client can file", naming the ledgers we could not read.
> - **Nothing:** both blocking statements read fine.
>
> The grey box must never read as an all clear. It is genuinely "we do not know".

**Step 4.** Click through the tabs. Tabs are named exactly as the portal names them.

> **Cash ledger** and **Credit ledger** and **Liability register** all show: Date, Reference /
> description, IGST, CGST, SGST, Cess, Balance. Opening and closing rows are bold on a tinted
> background, because those are the answer and the rows between them are the working.
>
> **RCM liability / ITC** has its own columns: Return period, Filed, 3.1(d) RCM paid, 4A(2)/(3) ITC
> claimed, Closing. It reconciles two GSTR-3B tables rather than carrying movements.
>
> A tab with a **red dot** on it is one that is blocking the return.

**Step 5.** Open a tab we cannot read.

> **What you should see.** A plain sentence explaining that we could not read it. **Not an empty table.**
> An empty table reads as "nothing wrong here", which is the opposite of what is true.

**Step 6.** Press **Sync**.

> On the office-PC route: the page says it is reading from the portal and that it takes about a minute.
> Leave it. It should fill itself in without you refreshing.
>
> On the OTP route with no live session: you should be offered a way to get an OTP, on this page.

---

## Workflow 3: getting a live session and pulling real data

*Needed for the ledgers, e-invoice and DRC screens, which have no stored data on dev.*

### 3a. The OTP route (ConnectorTest or SOTOWORX)

**Step 1.** Open any screen that needs portal data. The session panel is on the page itself.

**Step 2.** Click **Request OTP**.

> **What you should see.** A confirmation first: "Send OTP to the client?" It sends a real message to
> the client, so it must never fire on a single click.

**Step 3.** Get the six digits from the client and type them in. Click **Verify**.

> **What you should see.** "Connected", and the session runs for six hours.
>
> **What must happen next, without a refresh.** The screen you are on should load its data by itself. If
> you have to reload the page, that is a bug.

**Step 4.** Try a wrong OTP on purpose.

> You should get a plain sentence, for example "That OTP didn't match. Re-enter it, or resend a new one."
> You should never see a raw error from the provider.

### 3b. The office-PC route (Selvaraj)

**Step 1.** Make sure the connector is running on the paired PC. In ops admin, **Connector logs** shows
each firm's machines and when each was last seen.

**Step 2.** Open a client's ledgers and press **Sync**.

**Step 3.** Watch what the screen says.

> "Reading these ledgers from the GST portal. It takes about a minute, and this page will fill itself
> in. You can leave it and come back."
>
> **What must never appear.** Any figure presented as final, any "nothing found", and anything claiming
> to know whether the PC is on. We only queued a job; we cannot know.

**Step 4.** Wait. Do not touch anything.

> The page should fill itself in when the data lands, with no refresh from you.

**Step 5.** Now look at the Network tab.

> When the data arrives the page reloads **once**. It must **not** ask the portal again.
>
> **Why this matters.** A month a client never filed is missing for ever. If the reload asks again, the
> answer arrives, which triggers another reload, which asks again. Every lap is a portal login and a
> captcha on somebody's office machine, going round for ever.

---

## Workflow 4: the liability and ITC comparison, and DRC intimations

*The check that predicts a notice before it arrives.*

**Step 1.** Open a client's ledgers and choose the last tab, **Liability & ITC comparison**.

Use **CALYPSO FERTILIZERS** (40 months stored), **SRI ANNAMAR FIBRES** (28) or **KARIKALI AMMAN
TRADERS** (27). This tab works from stored returns, so it needs no portal session.

**Step 2.** Read the four counters.

> Liability 3B vs GSTR-1, ITC 3B vs 2B, RCM 3B vs 2B, Months compared.

**Step 3.** Find a month where the difference is red, and understand why.

> **Only two directions are red, and this is the point of the screen:**
>
> | Situation | Meaning | Red? |
> |---|---|---|
> | 3B liability **below** GSTR-1 | Tax declared but not paid. DRC-01B is raised on it, and it blocks the next GSTR-1 | **Yes** |
> | 3B ITC **above** 2B | More credit claimed than the portal allowed. DRC-01C is raised on it | **Yes** |
> | 3B liability above GSTR-1 | Client paid more than they declared. Costs them money, breaks no rule | No |
> | 3B ITC below 2B | Client under-claimed. Costs them money, breaks no rule | No |
>
> **Test the opposites deliberately.** Colouring an under-claim red sends a CA chasing something that is
> not a problem, and that is a real bug.

**Step 4.** Find a month we do not hold in full.

> It should show **blanks**, and be named under the table, and the total should say how many months it
> actually covers. A zero difference for a month we never read would say "this month is fine".

**Step 5.** Look at the intimations panel on the right. There are three possible states.

> - **Red panel:** an intimation is outstanding. It names the form, the period, the reference and the
>   amount, and says the next GSTR-1 is blocked until it is answered.
> - **Panel saying none outstanding:** we read the portal's list and it was empty, with the time we read it.
> - **Panel saying not checked:** we have not read the list at all.
>
> **Test the difference between the last two hardest.** "We looked and there is nothing" and "we have
> not looked" must never be shown as each other. On dev today it should say **not checked**, because no
> DRC list has ever been read.

---

## Workflow 5: reconciling a month's purchases

*The biggest screen in Phase 2, and the one a CA uses most.*

**Step 1.** RECONCILIATION → **Purchase vs 2A / 2B**.

**Step 2.** Pick **SHRI RAJESHWARI BUILDERS** and a month it has, for example **Jul 2024** or
**Apr 2026**. It has 321 supplier invoices over 16 months and 11 credit notes, so there is plenty to see.

**Step 3.** If no purchase register exists for that month, click **Import register**.

> **Step 3a.** Pick a file already on the client, or upload one.
>
> **Step 3b.** Check the column mapping. The list of fields should be **filled in when the dialog
> opens**, with our guesses already selected where the header was obvious. A blank list is a bug.
>
> **Step 3c.** Import stays disabled until a bill number column and a value column are chosen. That is
> deliberate: without a bill number nothing can be matched.
>
> **Step 3d.** Import. **Count the rows afterwards** and check the total matches the file.

**Step 4.** Read the five counters, then the bucket list down the left.

> Reasons are grouped: MATCHED, PARTIALLY MATCHED, UNMATCHED. Reverse charge gets its own line, and
> purchases from unregistered persons are counted separately with a note that they can never appear in
> 2B, because nobody filed them.

**Step 5.** Click a bucket and read the last column of the table.

> **This is the column the whole screen exists for.** It must say *why*, in words: "supplier has not
> reported this invoice", not merely "no match". A CA told only that something did not match has been
> handed the work rather than the answer, and the next thing they do is open the portal.

**Step 6.** Switch to **Supplier-wise**.

> One line per supplier, worst first, opening to their invoices. Chasing a difference means ringing a
> supplier, not an invoice.

**Step 7.** Try a hand-made link. Tick two rows on opposite sides and click **Link selected**.

> One delivery billed as two invoices is common. A hand-made link should survive re-importing the
> register, because a person looked at the documents and that beats anything worked out automatically.

**Step 8.** Change the tolerance and re-run.

> A rupee either way is not a finding. The tolerance should be remembered for that month.

---

## Workflow 6: head-office credit (ISD)

*Screen 16. What the head office distributed, against what the branch expected.*

**Step 1.** On Purchase vs 2A / 2B, click the third tab, **Head-office credit**.

> The whole comparison should change, not just the table. This is its own screen with its own counters.

**Step 2.** With no ISD register imported, read the amber note.

> It should say there is nothing to compare the distribution against, and offer **Import ISD register**.
>
> **Why this matters.** Without a books side, every distribution would show as "in portal only", which
> reads as an accusation rather than a fact.

**Step 3.** Import an ISD register.

> Same picker and the same three steps as the purchase register. A firm that has imported one already
> knows how to import the other.
>
> **Only the document number is required.** A distribution of nil tax is a real thing, so a register
> with no amount column must still import.
>
> **Use a file with at least 25 rows and count them afterwards.** See workflow 8.

**Step 4.** Read the statuses. There are five, and two of them look similar and are not.

> | Status | What it means | What to do |
> |---|---|---|
> | Matched | Both sides agree | nothing |
> | **Partial, books** | The branch booked **more** than was distributed | their figure is too high |
> | **Partial, ISD** | The head office distributed **more** than was booked | they have **under-claimed** |
> | In books only | Expected, never received | often lands next month; if not, cannot be claimed |
> | In portal only | Received, never booked | claimable credit nobody has asked for |
>
> The two partials are **opposite problems**. If the screen lumps them into one amber "partial", a CA
> has to open every row to find out which way it goes. That is the thing to check here.

**Step 5.** Use the three actions in the right panel.

> **Accept 2B value**, **Carry forward**, **Ask HO**. Accept 2B value must **not** be offered when the
> head office distributed nothing, because there is no portal figure to take.

**Step 6.** Re-import a corrected register.

> The decisions you made must still be there. They are kept against the document, not against a row
> number, so re-reading a file never throws away work somebody did by hand.

**On dev today:** not one of the 84 stored GSTR-2Bs contains an ISD entry, so the portal side will be
empty for every client. You can still test the whole books side, the import, and the "in books only"
status. Everything will read "in books only", and that is correct.

---

## Workflow 7: e-invoices, e-commerce and e-way bills

**Step 1.** RECONCILIATION → **E-way Bill & E-invoice**. Pick a client and a month.

### E-invoices vs GSTR-1

**Step 2.** Read the five counters.

> **Cancelled, still filed** is the red one, and it is the only one that is a real problem: the invoice
> was cancelled but is still in the return, so the buyer's credit cannot be supported. The other two
> are usually innocent, which is why they are not red.

**Step 3.** Read the table.

> It lists only what does **not** line up, worst first. A high severity row is tinted and carries a
> **High** pill. Every row says in words what differs.

**Step 4.** Try a client where we could not read either side.

> The screen should say so and show **no table at all**. A table with nothing in it would read as
> "every e-invoice matches", which is a different statement.

### E-way bills vs GSTR-1

**Step 5.** Open the middle tab.

> **This comparison cannot be built, and that is the expected result.** There is no e-way bill data in
> the Whitebooks API at all: 281 endpoints across 30 folders, and not one mention of e-way bills. It
> needs a separate NIC subscription.
>
> **What you should see.** A plain explanation of why, and what the check would have caught. Not an
> error, not a spinner, not an empty table, and definitely not a zero.

### E-commerce vs GSTR-1

**Step 6.** Open the third tab.

> Three counters: Operators, Reported supplies, TCS collected. TCS is green, because it is money to
> claim back rather than a problem.
>
> Table 14 shows a **dash** where we do not hold the seller's own figure, never a zero. A zero would say
> the seller declared nothing.
>
> Only totals exist here, because that is all the portal carries: an operator reports a month's supplies
> through them, never the individual orders.

---

## Workflow 8: the four regression tests

These are bugs that were found and fixed while Phase 2 was built. Each is easy to re-introduce, so run
all four after any change to these screens.

### 8.1 The request storm

On 28 September a screen re-drew itself into a loop and asked the server for one client's ledgers
**554 times in 13 seconds**, about forty a second, until the rate limiter started refusing and the
browser had to be closed.

**Step 1.** Open dev tools, **Network**, filter to **Fetch/XHR**, clear it.

**Step 2.** Open **GST Ledgers** and click into any client.

**Step 3.** Wait 30 seconds and touch nothing.

**Step 4.** Count the calls to `gst-ledgers/client/...`.

> **Pass:** one or two.
> **Fail:** dozens, or a number that keeps climbing. Screenshot the Network tab and report it immediately.

**Step 5.** Repeat on the **E-way Bill & E-invoice** page, and on a client's **GST Checks** panel. All
three used the same piece of code.

### 8.2 The ISD import must take every row

The browser only ever holds the first ten rows of a file preview. Importing from that would have taken
ten distributions and reported a clean month for a branch with forty, and it would have looked like it
worked.

**Step 1.** Build an ISD register with at least **25 rows**.

**Step 2.** Import it on the Head-office credit tab.

**Step 3.** The **In books** counter must read 25.

> Ten is the failure. So is any number that happens to be the preview size.

### 8.3 The GSTR-1A check

A database rule was out of date and rejected three new record types.

**Step 1.** Open GSTR-1A for a client and press **Check now**.

**Step 2.** It must return a result. An error here means the fix has been lost.

**Step 3.** Run the filing pre-flight on a client whose return is already filed. It must notice that it
is filed.

### 8.4 The re-fetch loop

Covered by step 5 of workflow 3. Worth repeating whenever any of these screens change.

---

## Workflow 9: the words on screen

A short pass, done once across the whole product. Ten minutes, and it catches things nothing else does.

**Step 1.** Open every Phase 2 screen in turn and use your browser's find (Cmd-F or Ctrl-F) for the
word **Whitebooks**. Then for **Connector**.

> **Neither word may appear anywhere a CA can read it.** Not on a screen, not in a toast, not in an
> error message. They are our internal words for two pipes, and which pipe the data came down is not
> the user's problem. Their only question is "is anything needed from me right now".

**Step 2.** Look for any screen that explains the difference between the two routes.

> There should not be one.

**Step 3.** Look for any message that claims to know whether the office PC is switched on.

> We generally cannot know that at the moment of asking, because we only queue a job. Copy that pretends
> otherwise is wrong.

**Step 4.** Check the colours mean one thing everywhere.

> Red stops work. Amber is money held up. Green is money to use or nothing to do. Grey is "we could not
> read it" and is never a colour. A screen that uses red for something that is merely unusual has
> weakened red everywhere else.

---

## Appendix A: test data on dev, at a glance

### Firms

| Firm | Route | Clients with data |
|---|---|---|
| Selvaraj & Co Auditors | office PC | 10 |
| ConnectorTest | OTP | 3 |
| SOTOWORX | OTP | 1 |

### Selvaraj clients worth using

| Client | Stored | Best for |
|---|---|---|
| SHRI RAJESHWARI BUILDERS | 321 invoices, 16 months, 11 credit notes | Purchase reconciliation |
| CALYPSO FERTILIZERS | 172 invoices, 40 months, 11 imports, 3 credit notes | Purchase reco, comparison tab |
| SRI ANNAMAR FIBRES | 28 months of GSTR-1 and 3B | Comparison tab |
| KARIKALI AMMAN TRADERS | 27 months of GSTR-1 and 3B | Comparison tab |
| STARLINE TRANSPORT, SHREE CABLE VISION | Apr to Jul 2026 | Quick runs |
| AMMAN AGENCIES | 5 months of 2B, none with invoices | The honest-empty case |

### What is not there, and why

| | |
|---|---|
| ISD credit | Not one of the 84 stored GSTR-2Bs has an ISD entry |
| Any ledger | No ledger has ever been pulled for any client |
| E-invoices, DRC intimations | Same |

Those three need one live portal session to test with real figures. Everything else works from what is
already stored.

---

## Appendix B: what to put in a bug report

1. Firm and client, by name
2. Month or financial year
3. What you expected, and what you saw
4. A screenshot
5. For anything that looks like a loop or a hang: a screenshot of the Network tab

**Raise anything that shows a figure for something nobody looked at straight away**, rather than
waiting for a ticket to be triaged. A zero where the answer is really "we never asked" tells a CA their
client is fine, and that is the one failure this whole phase is built to avoid.
