// Fictional demo data. Do not replace with real people's letters or real employer details.

import type { Answers, StudentIntake } from "../src/core/types";

export const intake: StudentIntake = {
  studentName: "Jordan Rivera",
  preferredName: "Jordan",
  pronouns: "they/them",
  recommenderName: "Dr. Priya Nair",
  recommenderEmail: "priya.nair@example.com",
  relationship: "my supervisor at Harbor Labs, where I am a software engineering intern",
  factSheet: `Software engineering intern at Harbor Labs, Jan 2026 to present.
Built TideWatch, a dashboard that flags sensor outages for a coastal monitoring network; cut outage detection from about 6 hours to 15 minutes.
Presented TideWatch to 12 city planners in October 2026.
B.S. Computer Science, Lakeshore University, GPA 3.7, May 2027.`,
  programs: [
    {
      id: "lakeshore-ai",
      school: "Lakeshore University",
      name: "M.S. in Applied AI",
      dueDate: "2026-12-15",
      submission: "upload",
      description: "Applied AI research program ending in an independent project.",
    },
    {
      id: "northgate-aip",
      school: "Northgate Institute",
      name: "M.S. in AI Policy and Management",
      dueDate: "2026-12-01",
      submission: "both",
      description: "Trains people to deploy and govern AI inside organizations.",
      formQuestions: [
        { key: "capacity", label: "How long and in what capacity have you known the applicant?" },
        { key: "effort", label: "Does the applicant give maximum effort and persevere toward goals?" },
        { key: "group", label: "How does the applicant work in a group and/or lead?" },
        { key: "communication", label: "Describe the applicant's oral and written communication." },
        { key: "rating", label: "Overall recommendation" },
      ],
      ratingOptions: ["Strongly recommend", "Recommend", "Recommend with reservations", "Do not recommend"],
    },
  ],
};

/** Answers keyed to the DEFAULT question set (no LLM). Messy on purpose, like speech-to-text. */
export const answers: Answers = {
  F1: { text: "I am Priya Nair, um, I'm a principal engineer at Harbor Labs and I lead the data reliability team." },
  F2: { text: "I have known Jordan since January 2026 when they joined as an intern, I see them, uh, pretty much every day and we meet one on one weekly." },
  F3: { text: "I am recommending Jordan because they take ownership of hard problems and they check their own work before anyone asks." },
  D1: { text: "In this role interns work on real production systems, you know, there is no sandbox, so mistakes reach real users." },
  D2: { text: "Jordan's main work is TideWatch, a dashboard that flags sensor outages, and the city's monitoring team relies on it every morning." },
  D3: { text: "Jordan built the outage detection logic and the alerting pipeline themselves, and they wrote the tests for it." },
  D4: { text: "When we compared TideWatch alerts against the manual logs, it missed short outages. Jordan dug into it and found the polling interval was too long, and they fixed it in a week." },
  D5: { text: "That told me they trust evidence over their own first design." },
  D6: "SKIPPED",
  D7: { text: "For example, they pushed back on a deadline because the tests were not passing, and they were right." },
  D8: { text: "When Jordan presented TideWatch to the city planners they explained outages with a simple tide chart, and two of the planners asked for access the same day." },
  D9: { text: "On a team Jordan reviews other interns' pull requests without being asked." },
  D10: { text: "When the sensor vendor changed their data format with no notice, Jordan kept the dashboard running by adding a translation layer over a weekend." },
  D11: { text: "In writing Jordan is clear and short, their incident notes are the ones I forward to leadership." },
  D12: { text: "What stands out about Jordan is patience. They walked a new intern through our deploy process three times without any frustration." },
  F4: { text: "Of the roughly 15 interns I have supervised, Jordan is in the top three, because they need the least direction." },
  FIT1: { text: "This program fits Jordan because they already do applied research on messy real data, and an independent project is how they work best." },
  FIT2: { text: "This program fits Jordan because they think about who is affected when a system fails, and I see them leading a reliability or AI governance team." },
  F5: { text: "I recommend Jordan without reservation. The committee can reach me at priya.nair@example.com." },
  F6: { text: "Strongly recommend" },
  F7: { text: "Nothing else, thank you." },
};

/** A simulated LLM call 2 output that cheats in three ways, to prove the claim check catches it. */
export const cheatingAssembly = {
  paragraphs: [
    { section: "opening", programScope: "all", sentences: [
      { text: "I am Priya Nair, a principal engineer at Harbor Labs, where I lead the data reliability team.", sources: ["F1"] },
      { text: "Jordan Rivera is the best intern I have ever supervised.", sources: ["F3"] },
    ] },
    { section: "work", programScope: "all", sentences: [
      { text: "Jordan built the outage detection logic, cutting detection time by 40%.", sources: ["D3"] },
      { text: "Their work was praised by the Mayor of Bayport.", sources: ["D2"] },
    ] },
  ],
  cuts: [],
  checks: [],
};

/** A simulated LLM call 1 output with one leading question mixed in. */
export const generatedQuestions = {
  questions: [
    { section: "context", prompt: "What is the setting where you worked together, and what makes it demanding?", opener: "In this role,…", formMappings: [] },
    { section: "work", prompt: "What is the main project you saw Jordan work on, and who relies on it?", opener: "Jordan's main project…", formMappings: ["field"] },
    { section: "work", prompt: "How did Jordan's exceptional work on TideWatch cut outage detection to 15 minutes?", opener: "Jordan…", formMappings: [] },
    { section: "work", prompt: "What did Jordan personally build or own?", opener: "Jordan…", formMappings: ["field"], memoryJog: "Built TideWatch outage detection" },
    { section: "work", prompt: "Was the work ever tested against reality? What happened?", opener: "When we…", formMappings: ["effort"] },
    { section: "leadership", prompt: "What separates someone good in your field from someone merely competent?", opener: "I often tell people…", formMappings: ["field"] },
    { section: "leadership", prompt: "Give one specific time Jordan showed that quality?", opener: "For example,…", formMappings: ["group"] },
    { section: "leadership", prompt: "Describe a time Jordan explained something technical to non-specialists. What happened?", opener: "When Jordan presented…", formMappings: ["communication"] },
    { section: "teamwork", prompt: "How does Jordan work with teammates?", opener: "On a team, Jordan…", formMappings: ["group"] },
    { section: "teamwork", prompt: "Tell me about a time something went wrong. How did Jordan handle it?", opener: "When…", formMappings: ["effort", "problem"] },
  ],
};
