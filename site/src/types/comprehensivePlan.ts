export type Policy = {
  id: number;
  title: string;
};

export type BasicGoal = {
  id: number;
  title: string;
  policies: Policy[];
};

export type PopulationProject = {
  id: number;
  title: string;
  theme: string;
};

export type PopulationVision = {
  name: string;
  period: { start: string; end: string };
  note: string;
  basic_strategies: { id: number; title: string }[];
  projects: PopulationProject[];
};

export type ComprehensivePlan = {
  name: string;
  future_vision: string;
  period: { start: number; end: number };
  basic_goals: BasicGoal[];
  population_vision: PopulationVision;
};
