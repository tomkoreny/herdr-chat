export default {
  id: "omp",
  label: "omp",
  images: "path",
  mirror: false,
  // An ask form is read from the session's log (the reader's `ask`) and answered whole, not read off the screen.
  prompt: { form: "log" },
  box: null,
  skills: { triggers: ["/"], invoke: "/", commands: true, user: ["~/.omp/agent/skills", "~/.agents/skills"], project: [".omp/skills", ".agents/skills"], skip: [] },
  status: { model: "switch", effort: "effort" },
  reader: "omp",
  // The file omp/herdr-chat-live.ts keeps the activity in, in the folder named after the session's log.
  live: "__live.json",
};
