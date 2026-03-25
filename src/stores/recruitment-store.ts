import { create } from "zustand";
import type { JobPosting, Applicant } from "@/types";

interface RecruitmentState {
  jobs: JobPosting[];
  applicants: Applicant[];
  selectedJob: JobPosting | null;
  selectedApplicant: Applicant | null;
  filterStatus: string;
  isCreateJobOpen: boolean;
  viewMode: "board" | "list";
  setJobs: (v: JobPosting[]) => void;
  setApplicants: (v: Applicant[]) => void;
  setSelectedJob: (v: JobPosting | null) => void;
  setSelectedApplicant: (v: Applicant | null) => void;
  setFilterStatus: (v: string) => void;
  setIsCreateJobOpen: (v: boolean) => void;
  setViewMode: (v: "board" | "list") => void;
}

export const useRecruitmentStore = create<RecruitmentState>((set) => ({
  jobs: [],
  applicants: [],
  selectedJob: null,
  selectedApplicant: null,
  filterStatus: "all",
  isCreateJobOpen: false,
  viewMode: "board",
  setJobs: (v) => set({ jobs: v }),
  setApplicants: (v) => set({ applicants: v }),
  setSelectedJob: (v) => set({ selectedJob: v }),
  setSelectedApplicant: (v) => set({ selectedApplicant: v }),
  setFilterStatus: (v) => set({ filterStatus: v }),
  setIsCreateJobOpen: (v) => set({ isCreateJobOpen: v }),
  setViewMode: (v) => set({ viewMode: v }),
}));
