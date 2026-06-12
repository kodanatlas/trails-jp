// §6 pre-solve, rule-based validation. Returns Japanese error messages.

import type { SolveInput } from "./types";
import { buildModel } from "./model";

export function validate(input: SolveInput): string[] {
  const errors: string[] = [];
  const model = buildModel(input);
  const { members, cars, routes } = model;

  const memberIds = new Set(members.map((m) => m.id));
  const driverIds = new Set(cars.map((c) => c.driverId));

  const name = (id: string) => id;

  // §6-0: at least one car (driver) must exist.
  if (cars.length === 0) {
    errors.push("運転手がいません");
    // Without any car the rest of the checks are meaningless; bail early.
    return errors;
  }

  // §6-1: capacity feasibility.
  // Hard error ONLY when even ALL cars combined cannot seat everyone. When the
  // always-only fleet is short but if_needed cars can cover the gap, that is NOT
  // an error (the solver activates if_needed cars) — see test case 5.
  const totalNeed = members.length;
  const totalCap = cars.reduce((s, c) => s + c.capacity, 0);
  if (totalCap < totalNeed) {
    const shortfall = totalNeed - totalCap;
    errors.push(`全車を出しても定員が ${shortfall} 人分不足しています`);
  }

  // §6-2: fixed target not participating / no car / over capacity.
  // capacity counts the driver's own seat, so the number of *additional* fixed
  // riders that fit is capacity - 1; equivalently cnt + 1 must be <= capacity.
  const fixedCountByDriver = new Map<string, number>();
  for (const f of input.fixed) {
    if (!memberIds.has(f.memberId)) {
      errors.push(`確約された ${name(f.memberId)} さんが参加者にいません`);
    }
    if (!driverIds.has(f.driverId)) {
      errors.push(`確約先の運転手 ${name(f.driverId)} さんの車がありません`);
      continue;
    }
    fixedCountByDriver.set(
      f.driverId,
      (fixedCountByDriver.get(f.driverId) ?? 0) + 1,
    );
  }
  for (const [driverId, cnt] of fixedCountByDriver) {
    const car = cars.find((c) => c.driverId === driverId);
    if (car && cnt + 1 > car.capacity) {
      errors.push(
        `${name(driverId)} さんの車に確約された人数(${cnt})が定員(${car.capacity})を超えています(運転手の座席を含む)`,
      );
    }
  }

  // §6-3: contradiction between fixed and locks, and self-contradictory locks.
  const fixedDriverOf = new Map<string, string>();
  for (const f of input.fixed) fixedDriverOf.set(f.memberId, f.driverId);
  const lockedDriverOf = new Map<string, string>();
  for (const lk of input.locks) {
    if (lk.memberId !== undefined) {
      const fd = fixedDriverOf.get(lk.memberId);
      if (fd !== undefined && fd !== lk.driverId) {
        errors.push(
          `${name(lk.memberId)} さんは確約先(${name(fd)})とロック先(${name(lk.driverId)})が矛盾しています`,
        );
      }
      // same member locked to two different drivers
      const prev = lockedDriverOf.get(lk.memberId);
      if (prev !== undefined && prev !== lk.driverId) {
        errors.push(
          `${name(lk.memberId)} さんが複数の車(${name(prev)}・${name(lk.driverId)})にロックされています`,
        );
      } else if (prev === undefined) {
        lockedDriverOf.set(lk.memberId, lk.driverId);
      }
    }
  }

  // §6-4: hard-specified node does not match any route (route_times missing).
  cars.forEach((car, c) => {
    const hn = car.hardNodes;
    if (!hn || hn.length === 0) return;
    let anyUsable = false;
    for (let k = 0; k < routes.length; k++) {
      const base = model.baseCK(c, k);
      if (base === undefined) continue;
      for (const node of hn) {
        if (routes[k].minutesToVenue[node] !== undefined) {
          anyUsable = true;
          break;
        }
      }
      if (anyUsable) break;
    }
    if (!anyUsable) {
      errors.push(
        `${name(car.driverId)} さんのhard指定地点がどのルートとも整合しません(ルート所要時間が未入力)`,
      );
    }
  });

  // §6-7: lock resolvability. A lock whose member/node/route cannot resolve to a
  // generated variable would otherwise be silently dropped by lp.ts, producing a
  // plan that ignores the operator's intent. Surface a Japanese error instead.
  for (const lk of input.locks) {
    const c = model.carIndex.get(lk.driverId);
    if (c === undefined) {
      errors.push(`ロックが適用できません: 運転手 ${name(lk.driverId)} さんの車がありません`);
      continue;
    }
    const allowedSet = new Set(model.allowed(c));
    if (lk.routeId !== undefined && model.routeIndex.get(lk.routeId) === undefined) {
      errors.push(`ロックが適用できません: ルート ${lk.routeId} が存在しません`);
    }
    if (lk.memberId !== undefined && model.memberIndex.get(lk.memberId) === undefined) {
      errors.push(`ロックが適用できません: ${name(lk.memberId)} さんが参加者にいません`);
    }
    // node-level resolvability (rider lock with a node, or a stop-only lock).
    if (lk.nodeId !== undefined) {
      const i = lk.memberId !== undefined ? model.memberIndex.get(lk.memberId) : undefined;
      const isDriverLock =
        i !== undefined && model.carDriverMemberIndex(c) === i;
      if (!allowedSet.has(lk.nodeId)) {
        errors.push(
          `ロックが適用できません: ${
            lk.memberId !== undefined ? name(lk.memberId) + "さんの" : ""
          }乗車地点${lk.nodeId}は運転手${name(lk.driverId)}のhard指定外です`,
        );
      } else if (lk.memberId !== undefined && i !== undefined && !isDriverLock) {
        // the member must actually be able to board at this node (access defined,
        // within accessMax, and the node usable on some route).
        const a = model.access(i, lk.nodeId);
        const accessMax = input.options.accessMaxMin;
        let nodeRouteOk = false;
        for (let k = 0; k < routes.length; k++)
          if (model.delta(c, lk.nodeId, k) !== undefined) { nodeRouteOk = true; break; }
        if (a === undefined || a > accessMax || !nodeRouteOk) {
          errors.push(
            `ロックが適用できません: ${name(lk.memberId)}さんは乗車地点${lk.nodeId}から運転手${name(lk.driverId)}の車に乗れません`,
          );
        }
      }
    }
  }

  // §6-8: earliest-departure feasibility against the driver's own start.
  // For an active (always) car with the driver's start defined and ed_c set,
  // (16) forces every member's start >= ed_c + B + T_c. Since the driver is
  // always in their own car, this requires start_driver >= ed_c + B + min_k base.
  // If even that minimum cannot be met, the car is structurally infeasible.
  if (!input.options.provisional) {
    const B = input.options.bufferMin;
    cars.forEach((car, c) => {
      if (car.willingness !== "always") return;
      if (car.earliestDepMin === null) return;
      const di = model.carDriverMemberIndex(c);
      if (di < 0) return;
      const driverStart = members[di].startMin;
      if (driverStart === null) return;
      // minimum achievable T_c is the smallest base(c,k) over feasible routes
      // (no detour). If no route is feasible §6-5 already reports it.
      let minBase = Number.POSITIVE_INFINITY;
      for (let k = 0; k < routes.length; k++) {
        const base = model.baseCK(c, k);
        if (base !== undefined) minBase = Math.min(minBase, base);
      }
      if (!Number.isFinite(minBase)) return;
      if (car.earliestDepMin > driverStart - B - minBase) {
        errors.push(
          `${name(car.driverId)} さんの出発下限ではご自身のスタートに間に合いません`,
        );
      }
    });
  }

  // §6-5 / §6-6: matrix gaps & isolated members.
  const gaps = new Set<string>();

  // (a) each car must reach venue on at least one route.
  cars.forEach((car, c) => {
    const home = model.carHome(c);
    let anyRoute = false;
    for (let k = 0; k < routes.length; k++) {
      if (model.baseCK(c, k) !== undefined) {
        anyRoute = true;
        break;
      }
    }
    if (!anyRoute) {
      gaps.add(`移動時間が未入力: ${home}→会場 (car)`);
    }
  });

  // (b) each member must have at least one feasible boarding option.
  const accessMax = input.options.accessMaxMin;
  members.forEach((m, i) => {
    let canBoardSomewhere = false;
    const missingTransit = new Set<string>();
    for (let c = 0; c < cars.length; c++) {
      if (model.carDriverMemberIndex(c) === i) {
        let carOk = false;
        for (let k = 0; k < routes.length; k++)
          if (model.baseCK(c, k) !== undefined) {
            carOk = true;
            break;
          }
        if (carOk) {
          canBoardSomewhere = true;
          break;
        }
        continue;
      }
      const allowedNodes = model.allowed(c);
      for (const p of allowedNodes) {
        const a = model.access(i, p);
        if (a === undefined) {
          if (model.homeOf(i) !== p)
            missingTransit.add(
              `移動時間が未入力: ${model.homeOf(i)}→${p} (transit)`,
            );
          continue;
        }
        if (a > accessMax) continue;
        let routeOk = false;
        for (let k = 0; k < routes.length; k++) {
          if (model.delta(c, p, k) !== undefined) {
            routeOk = true;
            break;
          }
        }
        if (routeOk) {
          canBoardSomewhere = true;
          break;
        }
      }
      if (canBoardSomewhere) break;
    }
    if (!canBoardSomewhere) {
      if (missingTransit.size > 0) {
        for (const g of missingTransit) gaps.add(g);
      } else {
        errors.push(`${name(m.id)} さんは乗車可能地点がありません`);
      }
    }
  });

  for (const g of gaps) errors.push(g);

  return errors;
}
