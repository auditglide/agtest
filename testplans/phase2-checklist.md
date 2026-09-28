# Phase 2 test checklist

**GST Ledgers, E-way Bill & E-invoice, Purchase vs 2A/2B, ISD, GSTR-1A, DRC intimations**

Everything built in Phase 2, as a tick list. The step-by-step version of each one is in the companion
document, *Phase 2 workflow guides*.

---

## How to use this

Tick a line only when you have seen it with your own eyes on the screen. A line you could not test
because the data was not there is **not** a pass: mark it *blocked* and say which client and month you
tried, so somebody can find you data or tell you it cannot exist.

Three columns of result are enough: **pass**, **fail**, **blocked**.

### Before you start, read this once

Most of Phase 2 reads figures from the GST portal, and the single most important thing to test is not
whether a number is right. It is whether the screen is **honest about what it does not know**.

There are three different things, and they must never be shown as each other:

| What is true | What the screen must say |
|---|---|
| We read it, here is the figure | the figure |
| We read it and there was nothing there | nil, or "no entries", clearly |
| We could not read it | "could not read", and a dash, never a 0 |

**A dash is not a zero, and a zero is not a blank.** If you ever see a `0` where we simply never looked,
that is a serious bug and worth a phone call, not a ticket. It tells a CA a client is fine when nobody
has checked.

### The two routes

A firm reads GST data by one of two routes, and this changes what you should expect:

- **Whitebooks** firms need the client to read out a one-time password (OTP). A live session lasts six
  hours. Data comes back **immediately**.
- **Connector** firms have a program on an office PC. No OTP. Asking for data **queues a job** and the
  answer arrives **about a minute later**, and only if that PC is switched on.

You need to test both. Which route a firm is on is set by ops.

**Those two words must never appear on any screen.** "Whitebooks" and "Connector" are our internal
words. Seeing either one in the app, a message or a toast is a bug, every time. Same for any screen
that tries to explain the difference to a CA.

### Picking a firm and a client to test with

Ask whoever runs the environment which firms are on which route, and **test both**. You want at least
one firm of each.

For a client, you want one with a few months of returns already stored, so the screen has something to
show without waiting on the portal. A client with nothing stored is worth testing too, but test it
knowingly: that is the "we have not looked yet" case, not a failure.

When a screen is empty, work out which of these three it is before raising anything:

| | How to tell |
|---|---|
| The client genuinely has nothing | The screen says nil, or no entries, and says it read the portal |
| We have never looked | The screen says so, and offers a way to read it |
| It is on its way | The screen says it is reading and that it takes about a minute |

Any of those three is fine. What is a bug is a fourth thing: a figure, usually a zero, shown for
something nobody looked at.

---

## 1. GST Ledgers, all clients

The firm-wide list. One row per client.

- [ ] The page opens from the left menu under FILING, and the menu entry reads **GST Ledgers**
- [ ] The financial year dropdown offers the current year and the two before it
- [ ] Changing the year reloads the list
- [ ] The line beside it says when the ledgers were last read, or "Nothing read from the portal yet"

### The five counters

- [ ] **3B will be blocked** counts clients with a negative credit reversal or RCM balance
- [ ] **ITC blocked, Rule 86A** counts clients with blocked credit
- [ ] **Negative liability to use** counts clients with negative liability waiting
- [ ] **Cash lying in ledgers** shows a rupee total, not a count
- [ ] **Could not read** counts clients with at least one ledger missing
- [ ] A counter that is zero is **not** coloured. Only a non-zero count is coloured

### The table

- [ ] Columns, left to right: Client, Cash, Credit, Credit blocked, Part II dues, Re-claim balance, RCM statement, Negative liability, Needs
- [ ] Client name is bold, with the GSTIN under it in a lighter monospaced font
- [ ] Clicking a client name opens that client's ledgers
- [ ] Figures line up in a column (monospaced), right aligned
- [ ] A ledger we could not read shows a grey dash, **never a 0**
- [ ] A negative re-claim balance or RCM statement is **bold red**
- [ ] Blocked credit and Part II dues are **bold amber** when there is any
- [ ] Negative liability is **bold green** when there is any
- [ ] Zero shows as a plain grey 0, not coloured

### Sorting and flags

- [ ] The list is sorted by what stops work first, **not** alphabetically
- [ ] Order of flags: 3B will be blocked, then ITC blocked, then Demand outstanding, then Negative liability to use, then Could not read, then Unused cash, then Clear
- [ ] A client with any unreadable ledger reads **Could not read**, never **Clear**
- [ ] Under a "Could not read" flag, the names of the missing ledgers are listed
- [ ] The line under the table explains that a blank means we could not read that ledger

### The side panels

- [ ] **Before the next 3B** lists the clients that cannot file, and those with money held up
- [ ] Each one says what to DO, not only what is wrong (for example, "reverse the excess in 4B(2)")
- [ ] Clicking a name in that panel opens that client
- [ ] When nothing is blocking, it says so rather than showing an empty box
- [ ] **Where the numbers come from** is present and says nothing here is typed by anyone

### When nothing has been read yet

- [ ] A line above the table says how many clients have never had their ledgers read
- [ ] Every row shows dashes and "Could not read"
- [ ] The counters show 0 for the flags and the real count under "Could not read"

---

## 2. GST Ledgers, one client

Seven tabs: six ledgers plus the comparison.

- [ ] Page title shows the client name and GSTIN
- [ ] **All clients** takes you back to the list
- [ ] The year dropdown works and reloads
- [ ] **Sync** reads from the portal and shows a result
- [ ] The line beside the tabs says when this ledger was last read

### The tab strip

- [ ] Seven tabs: Cash ledger, Credit ledger, Liability register, Credit reversal & re-claimed, RCM liability / ITC, Negative liability, Liability & ITC comparison
- [ ] The chosen tab is white and bold, sitting on a grey track
- [ ] A tab that is blocking the return carries a red dot
- [ ] Tabs are named exactly as the GST portal names them

### The balance strip

- [ ] Six tiles, one per ledger, above the table
- [ ] Clicking a tile switches to that tab
- [ ] The chosen tile is outlined in indigo
- [ ] A negative closing balance is bold red
- [ ] A ledger we could not read shows a grey dash and the words "could not read"
- [ ] A ledger that was read and was empty says "no entries", which is different

### Can this client file

- [ ] When a blocking statement is negative, a red box at the top says the client cannot file their GSTR-3B yet, and lists why
- [ ] When we could not read one of the blocking statements, a **grey** box says we cannot tell whether they can file, and names which ledger
- [ ] That grey box never says "all clear" or anything like it
- [ ] When both blocking statements read fine and are not negative, no box appears

### Each ledger tab

- [ ] Columns: Date, Reference / description, IGST, CGST, SGST, Cess, Balance
- [ ] Opening and closing rows are bold, on a tinted background
- [ ] Where a liability was settled, the row says whether it came from credit or from cash
- [ ] The RCM tab has its own columns: Return period, Filed, 3.1(d) RCM paid, 4A(2)/(3) ITC claimed, Closing
- [ ] A tab we could not read shows a plain sentence, not an empty table
- [ ] A tab that is genuinely empty says so, and adds that this is what the portal holds rather than a gap in our data

### The comparison tab

- [ ] One row per month, with a Total row at the bottom
- [ ] Three groups of columns: Liability (other than export and RCM), ITC (other than imports), RCM liability
- [ ] **3B below GSTR-1** shows bold red. This is what DRC-01B is raised on
- [ ] **3B ITC above 2B** shows bold red. This is what DRC-01C is raised on
- [ ] The **opposites are not red**. Declaring more tax than GSTR-1, or claiming less ITC than 2B allows, costs the client money but breaks no rule
- [ ] A month whose returns we do not hold shows blanks, never a zero difference
- [ ] Months with gaps are named under the table, and the total says how many months it actually covers
- [ ] The four counters at the top follow the same red rule
- [ ] The side panel explains how to read it, in plain words

### DRC-01B and DRC-01C intimations

- [ ] When the portal list has been read and something is outstanding, a red panel names the form, the period, the reference and the amount
- [ ] It says the next GSTR-1 is blocked until answered
- [ ] When the list has been read and was empty, a panel says no intimation is outstanding, with the time it was read
- [ ] When the list has **not** been read, a panel says exactly that, and asks you to press Sync
- [ ] "Not checked" and "none outstanding" are clearly different. This is the one to look at hardest

---

## 3. E-way Bill & E-invoice

Three tabs.

- [ ] Menu entry under RECONCILIATION reads **E-way Bill & E-invoice**
- [ ] Client and month dropdowns work
- [ ] Three tabs: E-invoices vs GSTR-1, E-way bills vs GSTR-1, E-commerce vs GSTR-1

### E-invoices vs GSTR-1

- [ ] Five counters: E-invoices, Matched, Cancelled still filed, Not in GSTR-1, No e-invoice found
- [ ] **Cancelled, still filed** is the red one. It means the buyer cannot claim credit
- [ ] The table lists only what does not line up, worst first
- [ ] Columns: Document, Buyer, IRN, E-invoice, GSTR-1, What differs
- [ ] A high severity row is tinted and carries a **High** pill
- [ ] Every row says in words what differs, not only that it differs
- [ ] When either side could not be read, the screen says so and shows **no table at all**

### E-way bills vs GSTR-1

- [ ] The tab opens and shows a plain explanation, not an empty table
- [ ] It says clearly that this comparison cannot be produced
- [ ] It explains what the check would have caught
- [ ] There is no error, no spinner that never ends, and no zero

### E-commerce vs GSTR-1

- [ ] Three counters: Operators, Reported supplies, TCS collected
- [ ] TCS is green, because it is money to claim back
- [ ] Table columns: Operator, Net reported, TCS, GSTR-1 Table 14, Note
- [ ] Table 14 shows a dash where we do not hold it, never a zero
- [ ] A line under the table explains that only totals exist, because that is all the portal carries

---

## 4. Purchase vs 2A / 2B

Screen 15 of the deck.

- [ ] Menu entry under RECONCILIATION reads **Purchase vs 2A / 2B**
- [ ] Client, month and 2A/2B source can all be changed, and each reloads
- [ ] **Import register** is offered when no purchase register exists for that month

### Importing a purchase register

- [ ] The dialog offers a file already on the client, and an upload
- [ ] The column list is filled in when the dialog opens, not blank
- [ ] Our guesses are pre-selected where the header is obvious
- [ ] Import stays disabled until a bill number column and a value column are chosen
- [ ] A saved mapping from a previous month is offered again
- [ ] After import, the row count matches the file. **Import a file with more than ten rows and count them**
- [ ] The file lands in the client's ordinary documents, not somewhere private to this screen

### The five counters

- [ ] In books, In 2B (or 2A), Matched, Partially matched, Unmatched
- [ ] Partially matched shows the tax at stake
- [ ] Unmatched splits into books only and portal only

### The bucket list and table

- [ ] The left list groups reasons under MATCHED, PARTIALLY MATCHED, UNMATCHED
- [ ] Reverse charge has its own line, and unregistered purchases are counted separately with an explanation that they can never appear in 2B
- [ ] Clicking a bucket filters the table
- [ ] Every row carries a **named reason**, not just "no match". For example "supplier has not reported this invoice"
- [ ] Green means matched, amber means the two sides differ by an amount, red means one side has nothing at all
- [ ] The rupee difference shows beside an amber row
- [ ] Supplier-wise view groups by supplier, worst first
- [ ] Rows can be ticked and linked by hand, and the link survives a re-import
- [ ] A hand-made link can be undone
- [ ] Tolerance can be changed and is remembered for that month
- [ ] Export to Excel produces what is on screen

---

## 5. Purchase vs 2B, ISD

Screen 16. The third view inside Purchase vs 2A / 2B.

- [ ] The third tab reads **Head-office credit**, with a count when there is any
- [ ] Choosing it replaces the whole comparison, not just the table
- [ ] With no ISD register imported, an amber note says there is nothing to compare against and offers **Import ISD register**

### Importing an ISD register

- [ ] Same picker and same three steps as the purchase register
- [ ] Only the ISD document number is required. A distribution with no tax must still import
- [ ] **Import more than ten rows and count them.** This is a regression test, see section 8
- [ ] The file lands in the client's ordinary documents

### The comparison

- [ ] Six counters: In books, In 2B ISD, Matched, Partially matched, Books only and portal only
- [ ] Table columns: ISD document, Service behind it, Books ITC, 2B ITC, Difference, Status
- [ ] Five statuses appear: Matched, Partial books, Partial ISD, In books only, In portal only
- [ ] **The two partials are different, and the screen must show which.** "Partial books" means the branch booked more than was distributed. "Partial ISD" means the branch has under-claimed
- [ ] The difference carries the row's colour
- [ ] The right panel lists only the differences nobody has settled
- [ ] Each one says what to do about it, in words
- [ ] Three actions: Accept 2B value, Carry forward, Ask HO
- [ ] **Accept 2B value is not offered** when the head office distributed nothing, because there is no portal figure to take
- [ ] After deciding, the row shows what was decided
- [ ] Re-importing a corrected register **keeps** the decisions
- [ ] The panel says where the credit flows (line 4(A)(4) of GSTR-3B)

---

## 6. GSTR-1A

- [ ] The screen opens and matches the deck
- [ ] Corrections can be added, edited and removed
- [ ] Rejections coming back from customers are shown and can be decided on
- [ ] Manual rows can be added
- [ ] **Check now** runs and returns a result without an error. See section 8
- [ ] The filing pre-flight notices when a return has already been filed

---

## 7. Behaviour that applies to every screen

Test this list on **each** of: GST Ledgers (client), E-invoice, Purchase vs 2A/2B, ISD.

### Landing on a screen with nothing stored

- [ ] The screen **asks the portal by itself**. It does not sit there empty waiting for a button
- [ ] It does not report an empty screen as a finding

### On a Whitebooks firm with no live session

- [ ] The screen offers a way to get an OTP, on the page itself
- [ ] Requesting an OTP asks for confirmation first, because it sends a message to the client
- [ ] After entering the OTP, the screen loads its data **without needing a page refresh**
- [ ] A wrong OTP gives a plain message, not a raw error

### On a Connector firm

- [ ] The screen says it is reading, and that it takes about a minute
- [ ] It does **not** say the figure is zero, nil, or that nothing was found
- [ ] The screen fills itself in when the data arrives, without a refresh
- [ ] **Open the browser Network tab and count the calls.** When the data arrives the screen must reload once and **must not ask the portal again**. A second ask means a loop, which costs a portal login every lap
- [ ] No OTP button is offered, because there is no OTP on this route

### Words on screen

- [ ] The words "Whitebooks" and "Connector" appear **nowhere**: not on screen, not in a toast, not in an error
- [ ] No screen explains the difference between the two routes
- [ ] No message claims to know whether the office PC is switched on

### Colours mean one thing everywhere

- [ ] Red only ever means something is stopped or broken
- [ ] Amber only ever means money held up, or two sides that differ by an amount
- [ ] Green only ever means money to use, or nothing to do
- [ ] Grey only ever means we could not read it, and is **never** a colour

---

## 8. Regression tests

Four bugs were found and fixed while Phase 2 was built. Each one is easy to re-introduce, so test all
four every time.

### 8.1 The request storm

Fixed 28 September. A screen re-drew itself into a loop and asked the server for one client's ledgers
**554 times in 13 seconds**, until the browser had to be closed.

- [ ] Open the browser dev tools, Network tab, filter to Fetch/XHR, and clear it
- [ ] Open **GST Ledgers** and click into a client
- [ ] Wait 30 seconds without touching anything
- [ ] Count the requests to `gst-ledgers/client/...`. There must be **one or two**, not dozens
- [ ] Repeat on the **E-way Bill & E-invoice** page
- [ ] Repeat on a client's **GST Checks** panel
- [ ] Anything above about five calls in half a minute is a fail. Screenshot the Network tab and attach it

### 8.2 ISD register import, all rows

Fixed the same day. The browser only ever holds the first ten rows of a preview, so importing from it
would have taken ten distributions and reported a clean month for a branch with forty.

- [ ] Make an ISD register with **at least 25 rows**
- [ ] Import it
- [ ] The "In books" counter must show 25, not 10

### 8.3 The GSTR-1A check and the filing pre-flight

A database check was out of date and rejected three new record types, so the GSTR-1A **Check now**
button failed at the database and the pre-flight could never store whether a return was already filed.

- [ ] Press **Check now** on GSTR-1A. It must return a result, not an error
- [ ] Run the filing pre-flight on a client whose return is already filed. It must notice

### 8.4 The re-fetch loop on the office-PC route

- [ ] Covered by the Network tab step in section 7. Worth repeating after any change to these screens

---

## 9. Known gaps. Do not raise these as bugs

These are things we genuinely cannot do today. They are on a register, and they are being worked on.
Every one of them shows a "could not read this" message rather than a zero, and **that message is the
correct behaviour**. If the message is missing, or a zero shows instead, THAT is the bug.

### Not available from Whitebooks

| What | Why |
|---|---|
| E-way bills, at all | Nothing in the whole Whitebooks API. Needs a separate NIC subscription |
| DRC intimations, e-invoice list, credit reversal, negative liability, blocked credit, RCM ledger, IMS rejections | Wired, but we have never seen a real response. They report "not checked" rather than guess |
| PMT-09 cash transfers | No endpoint anywhere. We do not yet know whether they appear inside the cash ledger |

### Not available on the Connector route

| What |
|---|
| Credit reversal & re-claimed, and negative liability |
| E-invoice, IMS, GSTR-7, GSTR-8, DRC-01B/01C, taxpayer search, late fee, challan history, return filing status, GSTR-1A |
| Credit notes, imports, ISD and e-commerce inside GSTR-2A |
| Filing. Filing always goes the Whitebooks way, whichever route a firm reads by |

Also on that route: it needs the office PC switched on, and it answers about a minute later rather
than immediately.

### Gaps in the environment, rather than in the product

Some screens will have nothing to show simply because nobody has read that data from the portal yet on
the environment you are testing. The ledgers, e-invoices and DRC intimations are the usual ones, since
they are new and nothing has pulled them before.

That is a **blocked** test, not a failure. To unblock it you need one live portal session on that
client: either an OTP on a firm that uses the OTP route, or the office PC switched on for a firm that
uses that route.

Say which client and month you tried when you mark something blocked, so somebody can either find you
data or tell you it cannot exist.

---

## 10. What to put in a bug report

1. Which firm and which client, by name
2. Which month or financial year
3. Which route that firm is on, if you know
4. What you expected, and what you saw
5. A screenshot of the screen
6. For anything that looks like a loop or a hang: a screenshot of the Network tab

The one thing worth saying loudest: **if a screen shows a figure for something nobody looked at, say
so immediately.** Everything else can wait for a ticket.
