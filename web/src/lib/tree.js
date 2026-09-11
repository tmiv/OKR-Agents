// The hand-written OKR tree. Flat array with parent pointers.
//
// `contributes` (0–1) is a hand-assessed score for how well a node supports its
// parent. Edge thickness and colour come from it, and anything under ~0.4 is the
// "misalignment" the demo is built to find. The weak KRs are deliberately
// vague, activity-shaped, or unmeasurable so there is something to fix.

export const initialTree = {
  nodes: [
    {
      id: 'co-1',
      level: 'company',
      parent: null,
      label: 'Become the default workflow platform for mid-market ops teams',
      owner: 'Exec',
      metric: 'share of mid-market ops teams (500–5k employees) on a paid plan',
      target: '6% → 15% by end of FY26',
      contributes: 1
    },

    // ── Product ─────────────────────────────────────────────────────────
    {
      id: 'obj-1',
      level: 'objective',
      parent: 'co-1',
      label: 'New accounts reach real value in their first week',
      owner: 'Product',
      metric: 'week-1 activation rate',
      target: '31% → 50%',
      contributes: 0.9
    },
    {
      id: 'kr-1',
      level: 'kr',
      parent: 'obj-1',
      label: 'Cut median time-to-first-workflow from 14 days to 5',
      owner: 'Product',
      metric: 'median days from signup to first workflow run',
      target: '14 → 5 by Q4',
      contributes: 0.9
    },
    {
      id: 'kr-2',
      level: 'kr',
      parent: 'obj-1',
      label: 'Lift week-1 activation from 31% to 50%',
      owner: 'Growth',
      metric: '% of new accounts with 3+ active workflows in week 1',
      target: '31% → 50% by Q4',
      contributes: 0.85
    },
    {
      id: 'kr-3',
      level: 'kr',
      parent: 'obj-1',
      label: 'Ship guided templates for the top 5 onboarding use cases',
      owner: 'Product',
      metric: 'templates live and used by ≥20% of new accounts',
      target: '0 → 5 by Q3',
      contributes: 0.7
    },
    {
      id: 'kr-4',
      level: 'kr',
      parent: 'obj-1',
      label: 'Redesign the settings page',
      owner: 'Design',
      metric: '',
      target: '',
      contributes: 0.25
    },

    // ── Marketing ───────────────────────────────────────────────────────
    {
      id: 'obj-2',
      level: 'objective',
      parent: 'co-1',
      label: 'Turn brand awareness into qualified mid-market pipeline',
      owner: 'Marketing',
      metric: 'marketing-sourced qualified pipeline',
      target: '$3.2M → $6M',
      contributes: 0.85
    },
    {
      id: 'kr-5',
      level: 'kr',
      parent: 'obj-2',
      label: 'Raise MQL → SQL conversion from 12% to 20%',
      owner: 'Marketing',
      metric: 'MQL to SQL conversion rate, trailing 90 days',
      target: '12% → 20% by Q4',
      contributes: 0.85
    },
    {
      id: 'kr-6',
      level: 'kr',
      parent: 'obj-2',
      label: 'Source $6M of qualified pipeline from marketing programs',
      owner: 'Marketing',
      metric: 'marketing-sourced pipeline (SQL stage or later)',
      target: '$3.2M → $6M by Q4',
      contributes: 0.9
    },
    {
      id: 'kr-7',
      level: 'kr',
      parent: 'obj-2',
      label: 'Improve our social media presence',
      owner: 'Marketing',
      metric: '',
      target: '',
      contributes: 0.2
    },
    {
      id: 'kr-8',
      level: 'kr',
      parent: 'obj-2',
      label: 'Publish 3 customer case studies in target verticals',
      owner: 'Content',
      metric: 'case studies published',
      target: '0 → 3 by Q3',
      contributes: 0.55
    },
    {
      id: 'kr-9',
      level: 'kr',
      parent: 'obj-2',
      label: 'Attend more industry events',
      owner: 'Field Marketing',
      metric: '',
      target: 'more than last year',
      contributes: 0.3
    },

    // ── Sales ───────────────────────────────────────────────────────────
    {
      id: 'obj-3',
      level: 'objective',
      parent: 'co-1',
      label: 'Win and expand mid-market accounts efficiently',
      owner: 'Sales',
      metric: 'new + expansion ARR from mid-market',
      target: '$12M new ARR',
      contributes: 0.95
    },
    {
      id: 'kr-10',
      level: 'kr',
      parent: 'obj-3',
      label: 'Close $12M of new ARR from the mid-market segment',
      owner: 'Sales',
      metric: 'closed-won new ARR, mid-market segment',
      target: '$7.5M → $12M by Q4',
      contributes: 0.95
    },
    {
      id: 'kr-11',
      level: 'kr',
      parent: 'obj-3',
      label: 'Raise net revenue retention from 104% to 115%',
      owner: 'Customer Success',
      metric: 'trailing-12-month NRR',
      target: '104% → 115% by Q4',
      contributes: 0.9
    },
    {
      id: 'kr-12',
      level: 'kr',
      parent: 'obj-3',
      label: 'Shorten the average mid-market sales cycle from 62 to 45 days',
      owner: 'Sales Ops',
      metric: 'median days from SQL to closed-won',
      target: '62 → 45 by Q4',
      contributes: 0.8
    },
    {
      id: 'kr-13',
      level: 'kr',
      parent: 'obj-3',
      label: 'Hire 6 account executives',
      owner: 'Sales',
      metric: 'AEs hired and ramped',
      target: '6 by Q2',
      contributes: 0.45
    },

    // ── Engineering ─────────────────────────────────────────────────────
    {
      id: 'obj-4',
      level: 'objective',
      parent: 'co-1',
      label: 'Ship a platform customers can bet their operations on',
      owner: 'Engineering',
      metric: 'monthly uptime + Sev-1 count',
      target: '99.95% uptime, ≤2 Sev-1 per quarter',
      contributes: 0.8
    },
    {
      id: 'kr-14',
      level: 'kr',
      parent: 'obj-4',
      label: 'Reach 99.95% monthly uptime on the workflow engine',
      owner: 'Platform',
      metric: 'monthly uptime, workflow engine',
      target: '99.8% → 99.95% every month from Q3',
      contributes: 0.9
    },
    {
      id: 'kr-15',
      level: 'kr',
      parent: 'obj-4',
      label: 'Reduce p95 workflow run latency from 8s to 2s',
      owner: 'Platform',
      metric: 'p95 end-to-end workflow run latency',
      target: '8s → 2s by Q4',
      contributes: 0.75
    },
    {
      id: 'kr-16',
      level: 'kr',
      parent: 'obj-4',
      label: 'Cut Sev-1 incidents from 9 per quarter to 2',
      owner: 'SRE',
      metric: 'Sev-1 incidents per quarter',
      target: '9 → 2 by Q4',
      contributes: 0.85
    },
    {
      id: 'kr-17',
      level: 'kr',
      parent: 'obj-4',
      label: 'Migrate CI to the new build system',
      owner: 'Dev Infra',
      metric: 'repos migrated',
      target: 'all repos by Q3',
      contributes: 0.35
    },
    {
      id: 'kr-18',
      level: 'kr',
      parent: 'obj-4',
      label: 'Deliver the SOC 2 Type II report',
      owner: 'Security',
      metric: 'report issued with zero exceptions',
      target: 'issued by end of Q3',
      contributes: 0.65
    },

    // ── People ──────────────────────────────────────────────────────────
    {
      id: 'obj-5',
      level: 'objective',
      parent: 'co-1',
      label: 'Grow a team that can sustain this pace',
      owner: 'People',
      metric: 'regretted attrition + time-to-fill',
      target: '8% attrition, 60-day time-to-fill',
      contributes: 0.55
    },
    {
      id: 'kr-19',
      level: 'kr',
      parent: 'obj-5',
      label: 'Reduce regretted attrition from 14% to 8%',
      owner: 'People',
      metric: 'annualised regretted attrition',
      target: '14% → 8% by Q4',
      contributes: 0.7
    },
    {
      id: 'kr-20',
      level: 'kr',
      parent: 'obj-5',
      label: 'Fill 90% of open roles within 60 days',
      owner: 'Talent',
      metric: '% of roles filled within 60 days of opening',
      target: '55% → 90% by Q4',
      contributes: 0.6
    },
    {
      id: 'kr-21',
      level: 'kr',
      parent: 'obj-5',
      label: 'Run a company offsite',
      owner: 'People',
      metric: '',
      target: '',
      contributes: 0.2
    }
  ]
};
