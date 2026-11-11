export default {
  id: "omp",
  label: "omp",
  images: "path",
  mirror: false,
  prompt: {},
  box: null,
  skills: { triggers: ["/"], invoke: "/", commands: true, user: ["~/.omp/agent/skills", "~/.agents/skills"], project: [".omp/skills", ".agents/skills"], skip: [] },
  status: { model: "switch", effort: "effort" },
  reader: "omp",
};
