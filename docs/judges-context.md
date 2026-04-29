# Judges' Context

> Source 1: Lunch & Learn / organizer-provided briefing material.
> Wording is preserved verbatim. Only the section headers below were
> added to make this scannable; everything inside the sections is
> exactly as the organizers wrote it.

---

## Source 1 — Organizers' briefing (verbatim)

### The hackathon

AI agents for Accountability (National AI Hackathon)
How can we productively and proactively use Artifical Intelligence to look at public spending and to identify opportunities and insights that will drive policy, save taxpayer money, and help to inform always new opportunities to run a more efficient, more effective public service.That's the intent and spirit of this hackathon.

The hackathon will bring together public sector leaders, industry and innovators to work on one shared problem.
How to use modern AI, especially Agentic systems to improve transparency, insights, and outcomes in government?
The  specific focus here is social spending and accountability.
The core question driving this is the public actually getting what they paid for?

You will be working with [real government data]: (https://github.com/GovAlta/agency-26-hackathon)
CRA: charity filings, FED - Federal Grants & Contributions - Federal contract data, corporate registeries, AB — Alberta Open Data.

[The challenges are: 10 life problems.](https://luma.com/5e83iia8?tk=95SBvc)
### Important Info from the Luma Link
Agency 2026 – Ottawa is a one-day AI hackathon bringing together public sector leaders, industry, and innovators to explore new approaches to social spending and accountability.
Participants will use modern AI tools and emerging agentic technologies to develop solutions to a live challenge focused on improving transparency, insights, and outcomes in government.
The event is designed to:
Showcase whatʼs possible with applied AI in government
Encourage new ideas and approaches to complex public challenges
Provide a platform for teams to build, demonstrate, and share their work
Strengthen collaboration across jurisdictions, sectors, and disciplines

Teams will present their work at the end of the day, with selected
participants recognized through awards. The event will bring together
hyperscalers and leading AI companies, alongside the Minister of Alberta
Technology and Innovation and federal, provincial, and territorial ministers
and deputy ministers.

Challenge Chosen:
5. Vendor Concentration
In any given category of government spending, how many vendors are actually competing? 
Identify areas where a single supplier or a small group of suppliers receives a disproportionate share of contracts. 
Measure concentration by category, department, and region.
Where has incumbency replaced competition?
Where has government become dependent on a vendor it can no longer walk away from?

Your job as hacker will be to 'Analyze government spending data to find waste, inefficiency, and gaps that are invisible today because nobody build a tooling to see them so you - then build a working AI solution that reveals real, actionable insights'.

### Who will be in the room

Who all will be in the room:
Minister of Technology and Innovation of Alberta - Nate Glubish
Deputy Minister of Technology and Innovation - Janak Alford
Federal, provincial, and territorial officials
Industry vendors (Google, Microsoft, Amazon, Cohere, and more)
Students, researchers, and AI practitioners.
Nate Glubish, Minister of Technology and Innovation of Alberta and Janak Alford - Deputy Minister of Technology and Innovation will be at the hackathon and on the judging panel to understand more around what is the art of the possible for Agentic AI for the government.

### Pick one clear problem

Pick one clear problem
The preference is going to be depth over breadth.
Try to find a narrow, well understood problem as opposed to a vague broad one.
Pick one challenge, go deep.
Pick a thread, unravel that thread, investigate that thread, cross reference your findings again and again and again.
The organisers have provided tons of data, so when you're pulling on threads, and you're trying to verify the accuracy of your data, it's super important to cross reference and double verify as many times as you can to really ensure that what your solution is saying is accurate and can be defended.
Ex: When you ask the same question twice, you may get very different answers, so cross-reference, and converge to make sure your solutions results are as accurate as possible.

### Use any good data

Whichever challenge we pick, feel free to use any good data if you find apart from the 3 already given by the organisers: cra, fed, ab.
Anything at your disposal that you believe can help you successfully complete the challenge.
Use the data you think is relevant and important for the challenge. That's going to be the key as well.

### Start simple, iterate fast

The recommendation is to start simple and iterate fast.
So pick something, investigate the data, investigate the challenges, get something working early, iterate, improve.
Don't overengineer from the start.
Work your way towards the end solution.

### Use AI for substance, not decoration

Use AI efficiently to help find insights rapidly and at scale.
Use AI to do the discovery and validation.
Not just pretty dashboards and visualisations, the judges want to see substance and solid information grounded behind those.
So be prepared to show your working as well and show that discovery of how you got to the end of validation and visualisation.

### Tell a clear story

When it comes to compiling results for the challenge, or how you're addressing the challenge, you want to be able to tell a clear story first.
You want to combine what you built from a technical level, your understanding of that problem, into a clear explanation that non technical audience can understand.
Tell the whole story, how you reached the problem, how you unravelled that problem, what were your findings, how you cross reference and validate those findings, technically how you address that, and then roll that up into a clear explanation that pretty much anyone can understand because you're going to have a short time to present.

### Keep it practical and explainable

Keep it practical and explainable.
The hackathon will have decision makers, so when you complete the challenge, think of it as something that a decision maker who may be non-technical can understand quite easily what you found and what decisions that could lead to.
Try to factor that not only as you're completing the hackathon, but preparing things for the presentation.

### Core theme across all challenges

In a nutshell, the core theme across all challenges is using AI for accountability in public spending. We're analyzing government spend, we're trying to find waste and efficiency gaps, and we're building a working AI solution that reveals some actionable insights.

### Three major sub-themes

Across these 10 challenges, beyond the core theme, there's really three major sub-themes:
1. Efficiency: is the money being well spent - that ties into challenges 1,4,5,8. You know identifying areas where funding may not be delivering expected public value.
2. Integrity: Are there opportunities to strengthen or put safeguard in place to ensure those gaps are closed? Are there any patterns that may identify potential gaps in processes. Maybe there's limited capacity, maybe there are circular flows that we need to investigate or highlight for further discussion.
3. Alignment: Does the spending align with what is being stated. Looking at the funding that's being spent and does it align with things like policies that are being stated, or analyzing procurement trends to understand what are the real key cost drivers here.

So all these sub-themes can tie into any one of these challenges. If you chose Vendor Concentration, unravel the challenge  and figure out the best solution.

---

Following are the datasets and apis that are being provided as part of the hackthon:

### 1. Government datasets

Three Canadian government open data sources, ~23M rows, unified in one PostgreSQL database.
The **[GovAlta/agency-26-hackathon](https://github.com/GovAlta/agency-26-hackathon)** repo includes numerous scripts and tools for your convenience. Start with index.html for a full schema tour. Review [KNOWN-DATA-ISSUES.md](http://KNOWN-DATA-ISSUES.md) for documented data quality issues.
- **CRA/** — ~8.8M charity T3010 filings (2020–2024) + circular-gifting & risk scores
- **FED/** — ~1.3M federal grants & contributions (2006-2025), 51+ departments
- **AB/** — ~2.6M Alberta grants, contracts, sole-source, non-profits (2014–2025)
- **general/** — our custom-built entity-matching layer: ~851K golden records linking the same org across CRA + FED + AB (One of the most difficult and important things to do is entity match organizations across all three datasets, so if you're referring to organization x in the fed db, can you accurately trace that same organization in the CRA and AB dataset - this is a time consuming and difficult task - so organizers have already done that for us in this general data set - this is going to be a big timesaver for you as a hacker)

**Note:** This dataset is optional and provided for convenience. Participants are encouraged to use any data sources that best support their solution.

The repo also contains a bunch of scripts that they use to build the database, to analyze it, and audit it for your convenience. Maybe you're looking to identify circular gifting. There are scripts already for that. There's infact already a table for that. For your convenience.

The data is provided for you as a starting point, it is optional to use, you are strongly encouraged to use any dataset that you deem appropriate for your solution to the challenge.

The dataset provided, explore it, see whats there, and think about how you can fit some of it in the challenges.

You are strongly encouraged to augment this data to make it a more richer solution to the challenge. Some challenges mention policies, or media, this data doesnt cover it so you have lots of opportunities to augment and improve add to the data set.

### 2. Ways to use the data

 - **Direct DB connection** — postgresql://database_database_w2a1_user:[JvqVh0msmuBrwgING68S52H0sz3wEEXI@dpg-d7auudv5r7bs738iqh70-b.replica-cyan.oregon-postgres.render.com](mailto:JvqVh0msmuBrwgING68S52H0sz3wEEXI@dpg-d7auudv5r7bs738iqh70-b.replica-cyan.oregon-postgres.render.com)/database_database_w2a1
 - **Raw data** — Data, in [JSONL format ~13.5GB](https://drive.google.com/file/d/1D3vb9x7WF2cEtt44n70nzHGXsAbLtaFQ/view?usp=sharing)
 - **Local copy** — .local-db/ rebuilds DB in your Postgres
 - **Analysis toolbox** —  Links to useful open source libraries (optional): [analysis-toolbox](https://drive.google.com/file/d/15qphCO9sWA24Fl-94fF17JAIMD9eUSQm/view?usp=sharing)

And above and beyond the scripts that are in the repo, there is also an analysis toolbox - the organisers have compiled a set of open source links that point to some really good analysis type libraries. You are free to use those at your discretion. Again, any AI tools and any APIs you're welcome to use it with the data.

### 3. Environments and APIs

- **Google Cloud Platform** — GCP environment with data loaded into BigQuery, plus Google's suite of tools and free limited APIs. Head to <#1495878853573476423> for details and to request access (must be requested at least 48 hours before the event).
 - **Amazon Web Services** — AWS environment with access to Amazon Bedrock with agent development tools and free limited APIs. Head to <#1496776492598820966> for details and to request access (must be requested at least 48 hours before the event).
- **Microsoft API endpoints** — Free limited LLM APIs will be provided on April 29 in: <#1496328771190394971>
**Please feel free to use your own AI tools and APIs as well**

You can augment this with any data set or include any data set that you find relevant to ensure this is thorough and complete and these challenges are addressed.

The hackthon is 6 hours long. As part of the submission the organisers would like a link to the repository of the teams github repo, the expectation is to have a live demo.

### How will we be scored

1. Impact & Significance: Do findings reveal real waste, fraud, or inefficiency at meaninful scale? 1-5 pts
2. Agent autonomy: How independently does the agent discover and validate insights without manual intervention? 1-5pts
3. Innovation & Originality: Does it apply AI in a creative or unexpected way to a public-sector challenge? 1-5pts
4. Presentation & clarity: Is the pitch clear and compelling? Could a non-technical decision maker understand and act on it? 1-5pts

Total 20 pts.

### What Judges Need to See

1. The problem you Chose: Clearly name the specific problem or question you investigated. Why did you pick that challenge?
2. The insights you found: What did your analysis reveal? Make it concrete and quantitative. Real numbers, real entities, real patterns. The moment in the build when you go, Huh this is interesting! That's what the judges want to hear about.
3. How you built it: Walk judges through your approach, logic, and tools used - don't skip this. Dont be tempted to skip the technical stuff in front of senior government officials. We would like to know how it works.
4. A Working Demo: Show your solution live, it should be functional, not just slides. The judges need to understand how your solution works, how you came to this solution, and why did you pick this specific problem. A beautiful frontend over a black box will lose to a rougher front end over a clear method. So show the themes, show the reasoning. If you use a tool, say which one and why, if you made a tradeoff name it. We don't need you to hide the complexity. We need to trust that you understand the problem and you found some interesting insights. So the judges would like to see all the complexities, how your mind works, how you got to the specific solution.

---

## Source 2 — (Discord) Sponsor environments: AWS, Google, Microsoft (Discord)

Since the hackthon is being sponsored by amazon, google, microsoft following are the things they are providing:

### AWS

AWS is sponsoring **Agency 2026**. Each team gets their own AWS account via Workshop Studio. No personal AWS account needed. Available to both in-person and remote participants.

**Your account includes:**
- **Amazon Bedrock** (https://aws.amazon.com/bedrock) -- Claude Opus 4.6, Claude Sonnet 4, and Amazon Nova. Access these models via the AWS console, CLI, SDK, or create Bedrock API keys to call directly from your code.
- **Strands Agents SDK** (https://github.com/strands-agents/sdk-python) -- open-source Python framework for building AI agents. Define tools, give the agent a goal, and let it reason and act over the dataset.
- **Amazon Bedrock AgentCore** (https://aws.amazon.com/bedrock/agentcore/) -- managed runtime for running agents with built-in memory, tool use, and orchestration.
- **Kiro** (https://kiro.dev) -- AI-powered IDE and CLI with 1000 credits per team. Tell it "analyze the CRA data for funding loops" and it writes the SQL and Python. Install it before the event: https://kiro.dev/downloads
- **S3, Lambda, Step Functions, DynamoDB** and other AWS services are also available in the account.

Connect to the organizer's PostgreSQL database using the credentials in <#1493444467871715408>. Your AWS account provides the AI and compute layer on top.

Up to 5 team members share one account. Accounts will be active from 8:00 AM ET on April 29 for the duration of the event.

**To get your environment**, fill out this form by **12:00 PM ET on Monday, April 27**: https://pulse.aws/application/MLIMJTF2
We need your team name and an email per member (any email, used for login only). We will DM your team an access code before April 29. Submissions after the deadline may not be provisioned in time.

On hackathon day: go to https://catalog.us-east-1.prod.workshops.aws/join, enter your code, start building.

Technical docs will follow closer to kickoff.

Questions? Post them here. AWS Solutions Architects will be in this channel and on-site during the event.

### Google

Google is proud to sponsor Agency 2026 Hackathon by providing teams with a fully funded Google Cloud project. You will have direct access to our advanced agentic and data processing capabilities to build and scale your hackathon solutions. Data will be preloaded into the environment to provide you rapid access to further exploration.

Action Required
Please fill out the Google Cloud Provisioning Form as soon as possible. Submit this form early and include your team members to ensure your environment is provisioned without any processing delays.

The Emails that you submit must have an associated Google account in order to gain access to the platform, this can be a Gmail account, Workspace account or any account you've logged into a Google service with. This doesn’t mean you have to be using gmail, if you’ve ever logged into a Google service with that account you will likely have a Google account associated with your email address.

Your funded project grants you access to a comprehensive suite of tools for data analysis and AI development, including

Agent Platform (formerly Vertex AI)
BigQuery
Gemini CLI
Google's Agentic Data Cloud

### Microsoft

Microsoft is pleased to support the Agency 2026 Hackathon by providing participating teams with access to Microsoft cloud services and tools to help you build, test, and scale your hackathon solutions. Where required, Microsoft will provision temporary licenses or access to enable teams to participate fully in the event. In some cases, data or sample datasets may be made available within the provided environment to accelerate exploration and development.

Action Required
Please complete the Microsoft Hackathon Participant Information form as soon as possible. Submit the form early and include all required participant details to help ensure any necessary access or licenses can be provisioned without delay.

Complete the form here: https://forms.microsoft.com/r/CrrgKpe6S2

The email addresses you provide may be used to provision individual licenses or access required for hackathon participation. Please ensure all email addresses submitted are valid and accessible by your team members.

Platform Access
Your provisioned environment may include access to a range of Microsoft technologies and services commonly used for data, AI, and application development to support hackathon activities.
Additional technical instructions, access details, and next steps will be shared closer to the hackathon kickoff.

---

<!-- Add additional sources below. Keep wording verbatim; only add a `## Source N — <label>` divider per source. -->
