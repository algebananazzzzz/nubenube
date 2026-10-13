//! The focus economy. Time inside a running timer earns rest at 1/ratio per
//! second; a Rest app or site spends it 1:1; the weekly bank is
//! Σ(earned − spent) since Monday and may go negative. Pure, so the rules are
//! tested apart from the OS watcher and the database.

use serde::{Deserialize, Serialize};

/// Finish-bonus multiplier steps. Unbroken focus inside a timer climbs one step
/// every `finish_every` minutes; the accrued extra is paid when the timer
/// finishes, drifting resets the climb, and stopping early forfeits it.
pub const FINISH: [f64; 4] = [1.0, 1.15, 1.3, 1.5];

pub fn finish_tier(run_secs: f64, every_min: f64) -> usize {
    let step = (every_min * 60.0).max(1.0);
    ((run_secs / step).floor().max(0.0) as usize).min(FINISH.len() - 1)
}

pub fn finish_at(run_secs: f64, every_min: f64) -> f64 {
    FINISH[finish_tier(run_secs, every_min)]
}

#[derive(Clone, Copy)]
pub struct Rules {
    pub ratio: f64,
    pub target_bonus_secs: f64,
    pub finish_every_min: f64,
}

/// One calendar day of the week. Past days are history; today and later days
/// also carry the plan (target + rest) set on Home.
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub focus: f64,
    pub distract: f64,
    /// Rest earned, at the ratio in effect when it was earned, plus all bonuses.
    pub earned: f64,
    /// Rest spent on Rest apps and sites, in or out of a timer.
    pub spent: f64,
    pub target: Option<f64>,
    pub hit: bool,
    /// The daily-target bonus currently counted in `earned`.
    pub bonus: f64,
    pub rest_plan: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Timer {
    pub len: f64,
    pub left: f64,
    /// Seconds of unbroken focus; drives the finish-bonus step.
    pub run: f64,
    /// Finish bonus accrued so far, paid only if the timer runs out.
    pub pending: f64,
    /// Base rest earned during this timer, for the "session done" summary.
    pub earned: f64,
}

impl Timer {
    pub fn new(minutes: f64) -> Self {
        let len = minutes * 60.0;
        Timer { len, left: len, run: 0.0, pending: 0.0, earned: 0.0 }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Foreground {
    /// Anything that isn't a Rest app: Work and Neutral both count inside a timer.
    Focus,
    Rest,
    Away,
}

#[derive(Debug, PartialEq)]
pub enum Event {
    Finished { earned: f64, bonus: f64 },
    TargetHit { bonus: f64 },
}

pub fn state(timer: bool, fg: Foreground) -> &'static str {
    match (timer, fg) {
        (true, Foreground::Rest) => "timerDrift",
        (true, _) => "timer",
        (false, Foreground::Rest) => "drift",
        _ => "idle",
    }
}

/// Re-derive the target bonus for `target`. Raising a hit target above today's
/// focus takes the bonus back out of `earned`.
pub fn apply_target(day: &mut Day, target: Option<f64>, bonus_secs: f64) {
    let hit = target.is_some_and(|t| day.focus >= t);
    let bonus = if hit { bonus_secs } else { 0.0 };
    day.earned += bonus - day.bonus;
    day.bonus = bonus;
    day.hit = hit;
    day.target = target;
}

/// Advance the economy by `dt` seconds with `fg` in front.
pub fn step(timer: &mut Option<Timer>, day: &mut Day, rules: &Rules, fg: Foreground, dt: f64) -> Vec<Event> {
    let mut events = Vec::new();
    let Some(t) = timer.as_mut() else {
        if fg == Foreground::Rest {
            day.distract += dt;
            day.spent += dt;
        }
        return events;
    };

    t.left -= dt;
    match fg {
        Foreground::Focus => {
            let base = dt / rules.ratio;
            day.focus += dt;
            day.earned += base;
            t.earned += base;
            t.run += dt;
            t.pending += (finish_at(t.run, rules.finish_every_min) - 1.0) * base;
            if !day.hit && day.target.is_some_and(|tg| day.focus >= tg) {
                apply_target(day, day.target, rules.target_bonus_secs);
                events.push(Event::TargetHit { bonus: rules.target_bonus_secs });
            }
        }
        Foreground::Rest => {
            t.run = 0.0;
            day.distract += dt;
            day.spent += dt;
        }
        Foreground::Away => {}
    }

    if t.left <= 0.0 {
        // Running out while drifted forfeits the bonus, same as stopping early.
        let bonus = if fg == Foreground::Rest { 0.0 } else { t.pending };
        day.earned += bonus;
        events.push(Event::Finished { earned: t.earned + bonus, bonus });
        *timer = None;
    }
    events
}

pub fn bank(week: &[Day]) -> f64 {
    week.iter().map(|d| d.earned - d.spent).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: Rules = Rules { ratio: 5.0, target_bonus_secs: 1800.0, finish_every_min: 15.0 };

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    fn run(timer: &mut Option<Timer>, day: &mut Day, fg: Foreground, secs: usize) -> Vec<Event> {
        (0..secs).flat_map(|_| step(timer, day, &R, fg, 1.0)).collect()
    }

    #[test]
    fn finish_tier_climbs_every_step_and_caps() {
        assert_eq!(finish_tier(0.0, 15.0), 0);
        assert_eq!(finish_tier(899.0, 15.0), 0);
        assert_eq!(finish_tier(900.0, 15.0), 1);
        assert_eq!(finish_tier(2700.0, 15.0), 3);
        assert_eq!(finish_tier(99_999.0, 15.0), 3);
    }

    #[test]
    fn focus_in_timer_earns_one_over_ratio() {
        let mut t = Some(Timer::new(10.0));
        let mut d = Day::default();
        run(&mut t, &mut d, Foreground::Focus, 300);
        assert!(close(d.focus, 300.0));
        assert!(close(d.earned, 60.0));
        assert!(close(t.unwrap().left, 300.0));
    }

    #[test]
    fn outside_a_timer_focus_earns_nothing_and_rest_spends_one_to_one() {
        let mut t = None;
        let mut d = Day::default();
        run(&mut t, &mut d, Foreground::Focus, 120);
        assert_eq!(d, Day::default());
        run(&mut t, &mut d, Foreground::Rest, 60);
        assert!(close(d.spent, 60.0));
        assert!(close(d.distract, 60.0));
    }

    #[test]
    fn drifting_in_a_timer_spends_one_to_one_and_resets_the_climb() {
        let mut t = Some(Timer::new(60.0));
        let mut d = Day::default();
        run(&mut t, &mut d, Foreground::Focus, 1000);
        assert_eq!(finish_tier(t.as_ref().unwrap().run, 15.0), 1);
        run(&mut t, &mut d, Foreground::Rest, 10);
        assert!(close(d.spent, 10.0));
        assert!(close(t.as_ref().unwrap().run, 0.0));
    }

    #[test]
    fn finishing_pays_the_pending_bonus() {
        let mut t = Some(Timer::new(20.0));
        let mut d = Day::default();
        let ev = run(&mut t, &mut d, Foreground::Focus, 1200);
        assert!(t.is_none());
        // Seconds 900..=1200 of the run are at ×1.15: 301 × 0.15 / 5.
        let base = 1200.0 / 5.0;
        let bonus = 301.0 * 0.15 / 5.0;
        assert!(close(d.earned, base + bonus));
        assert!(matches!(ev[..], [Event::Finished { earned, bonus: b }] if close(earned, base + bonus) && close(b, bonus)));
    }

    #[test]
    fn running_out_while_drifted_forfeits_the_bonus() {
        let mut t = Some(Timer::new(20.0));
        let mut d = Day::default();
        run(&mut t, &mut d, Foreground::Focus, 1199);
        let ev = run(&mut t, &mut d, Foreground::Rest, 1);
        assert!(matches!(ev[..], [Event::Finished { bonus, .. }] if bonus == 0.0));
        assert!(close(d.earned, 1199.0 / 5.0));
    }

    #[test]
    fn away_time_neither_earns_nor_spends_but_the_timer_runs() {
        let mut t = Some(Timer::new(10.0));
        let mut d = Day::default();
        run(&mut t, &mut d, Foreground::Away, 120);
        assert_eq!(d, Day::default());
        assert!(close(t.unwrap().left, 480.0));
    }

    #[test]
    fn target_hit_pays_the_bonus_once() {
        let mut t = Some(Timer::new(60.0));
        let mut d = Day { target: Some(100.0), ..Day::default() };
        let ev = run(&mut t, &mut d, Foreground::Focus, 150);
        assert_eq!(ev, vec![Event::TargetHit { bonus: 1800.0 }]);
        assert!(d.hit);
        assert!(close(d.earned, 150.0 / 5.0 + 1800.0));
    }

    #[test]
    fn raising_a_hit_target_takes_the_bonus_back() {
        let mut d = Day { focus: 500.0, earned: 100.0, ..Day::default() };
        apply_target(&mut d, Some(400.0), 1800.0);
        assert!(d.hit);
        assert!(close(d.earned, 1900.0));
        apply_target(&mut d, Some(600.0), 1800.0);
        assert!(!d.hit);
        assert!(close(d.earned, 100.0));
    }

    #[test]
    fn state_names() {
        assert_eq!(state(true, Foreground::Focus), "timer");
        assert_eq!(state(true, Foreground::Away), "timer");
        assert_eq!(state(true, Foreground::Rest), "timerDrift");
        assert_eq!(state(false, Foreground::Rest), "drift");
        assert_eq!(state(false, Foreground::Focus), "idle");
    }

    #[test]
    fn bank_nets_earned_against_spent() {
        let week = [
            Day { earned: 600.0, spent: 100.0, ..Day::default() },
            Day { earned: 0.0, spent: 900.0, ..Day::default() },
        ];
        assert!(close(bank(&week), -400.0));
    }
}
