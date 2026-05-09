import { useEffect, useState } from "react";
import type { StageKey } from "./types";

type StatusMap = Partial<Record<StageKey, "complete" | "active" | "locked" | "blocked" | "pending">>;

let currentStage: StageKey = "files";
let stageListeners: Array<(s: StageKey) => void> = [];

let currentStatus: StatusMap = {};
let statusListeners: Array<(m: StatusMap) => void> = [];

export function setActiveStage(s: StageKey) {
  currentStage = s;
  stageListeners.forEach((l) => l(s));
}

export function setStageStatus(m: StatusMap) {
  currentStatus = m;
  statusListeners.forEach((l) => l(m));
}

export function useActiveStage(): [StageKey, (s: StageKey) => void] {
  const [s, setS] = useState<StageKey>(currentStage);
  useEffect(() => {
    const fn = (x: StageKey) => setS(x);
    stageListeners.push(fn);
    return () => { stageListeners = stageListeners.filter((l) => l !== fn); };
  }, []);
  return [s, setActiveStage];
}

export function useStageStatus(): StatusMap {
  const [m, setM] = useState<StatusMap>(currentStatus);
  useEffect(() => {
    const fn = (x: StatusMap) => setM(x);
    statusListeners.push(fn);
    return () => { statusListeners = statusListeners.filter((l) => l !== fn); };
  }, []);
  return m;
}