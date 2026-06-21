// @ts-nocheck
import { ExecutionContext } from './types.js';

export function cloudCliInterceptor({ cmdBasename, args, envOverrides, payload }: ExecutionContext): void {
  const cloudCliCmds = ['wrangler', 'vercel', 'netlify', 'firebase', 'heroku', 'supabase', 'stripe', 'fly', 'flyctl', 'expo', 'eas', 'wrangler.cmd', 'vercel.cmd', 'netlify.cmd', 'firebase.cmd', 'heroku.cmd', 'supabase.cmd', 'stripe.exe', 'fly.exe', 'flyctl.exe', 'expo.cmd', 'eas.cmd'];
  if (cloudCliCmds.includes(cmdBasename)) {
    if (args.includes('login')) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} login' is highly interactive and will hang. Use API tokens via environment variables instead.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
    const subCmd = args.filter(a => !a.startsWith('-'))[0];
    if (['init', 'create'].includes(subCmd) && !args.includes('-y') && !args.includes('--yes')) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} ${subCmd}' is highly interactive. Automatically injecting '-y' to prevent hanging.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      args.push('-y');
    }
  }

  const trackerCmds = ['jira', 'jira.exe', 'jira.cmd', 'linear', 'linear.exe', 'linear.cmd', 'slack', 'slack.exe', 'slack.cmd'];
  if (trackerCmds.includes(cmdBasename)) {
    if (args.includes('login') || args.includes('auth')) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} login/auth' is interactive. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }

  if (['cargo', 'cargo.exe'].includes(cmdBasename) && (args.includes('login') || args.includes('publish'))) {
      console.error(`\n   💡 AGENT HINT: 'cargo login/publish' is interactive. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
  }

  if (['aws', 'aws.exe', 'aws.cmd'].includes(cmdBasename) && args.includes('configure')) {
      console.error(`\n   💡 AGENT HINT: 'aws configure' is interactive. Use environment variables instead.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
  }

  if (['gcloud', 'gcloud.cmd'].includes(cmdBasename) && args.includes('auth') && (args.includes('login') || args.includes('application-default'))) {
      console.error(`\n   💡 AGENT HINT: 'gcloud auth login' / 'application-default' is interactive. Use service accounts instead.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
  }

  if (['terraform', 'terraform.exe', 'tofu', 'tofu.exe'].includes(cmdBasename)) {
    const subCmd = args.filter(a => !a.startsWith('-'))[0];
    if (['apply', 'destroy'].includes(subCmd)) {
      if (!args.includes('-auto-approve')) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-auto-approve' into ${cmdBasename} ${subCmd} to prevent prompt hanging.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        args.push('-auto-approve');
      }
    }
  }

  const ghCmds = ['gh', 'gh.exe', 'gh.cmd'];
  if (ghCmds.includes(cmdBasename) && payload.type === 'command') {
    envOverrides['GH_PROMPT_DISABLED'] = '1';
    envOverrides['GH_NO_UPDATE_NOTIFIER'] = '1';
    envOverrides['NO_COLOR'] = '1';
    envOverrides['GH_PAGER'] = ''; // Ensure output doesn't hang in pager

    if (args.includes('--web')) {
      console.error(`\n   💡 AGENT HINT: 'gh ... --web' attempts to open a browser window and will hang indefinitely. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }

    const subCmd1 = args.filter(a => !a.startsWith('-'))[0];
    const subCmd2 = args.filter(a => !a.startsWith('-'))[1];
    
    if (subCmd1 === 'pr' && subCmd2 === 'create') {
      if (!args.includes('--fill') && !args.includes('--title') && !args.includes('--fill-first')) {
        console.error(`\n   💡 AGENT HINT: 'gh pr create' is interactive without '--fill' or '--title'/'--body'. Blocking execution to prevent hanging.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'pr' && subCmd2 === 'merge') {
      if (!args.includes('--auto') && !args.includes('--merge') && !args.includes('--squash') && !args.includes('--rebase')) {
        console.error(`\n   💡 AGENT HINT: 'gh pr merge' requires a merge strategy (--merge, --squash, --rebase, --auto) to be non-interactive. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'issue' && subCmd2 === 'create') {
      if (!args.includes('--title')) {
        console.error(`\n   💡 AGENT HINT: 'gh issue create' is interactive without '--title'. Blocking execution to prevent hanging.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'repo' && subCmd2 === 'create') {
      if (!args.includes('--public') && !args.includes('--private') && !args.includes('--internal')) {
        console.error(`\n   💡 AGENT HINT: 'gh repo create' is interactive without visibility flags (--public/--private). Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'pr' && subCmd2 === 'review') {
      if (!args.includes('--approve') && !args.includes('--request-changes') && !args.includes('--comment')) {
        console.error(`\n   💡 AGENT HINT: 'gh pr review' is interactive without a review type flag (--approve/--request-changes/--comment). Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'auth' && (subCmd2 === 'login' || subCmd2 === 'refresh')) {
      if (!args.includes('--with-token')) {
        console.error(`\n   💡 AGENT HINT: 'gh auth ${subCmd2}' is highly interactive. Provide a token via stdin and use '--with-token'.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'run' && subCmd2 === 'watch') {
      console.error(`\n   💡 AGENT HINT: 'gh run watch' is interactive/runs indefinitely. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    } else if (subCmd1 === 'release' && subCmd2 === 'create') {
      if (!args.includes('--title') && !args.includes('--notes') && !args.includes('--generate-notes')) {
        console.error(`\n   💡 AGENT HINT: 'gh release create' is interactive without release notes flags. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'release' && subCmd2 === 'delete') {
      if (!args.includes('-y') && !args.includes('--yes')) {
        console.error(`\n   💡 AGENT HINT: 'gh release delete' is interactive without '--yes'. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'repo' && subCmd2 === 'delete') {
      if (!args.includes('--yes')) {
        console.error(`\n   💡 AGENT HINT: 'gh repo delete' is interactive without '--yes'. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'issue' && subCmd2 === 'edit') {
      if (!args.includes('--title') && !args.includes('--body') && !args.includes('--add-assignee') && !args.includes('--add-label')) {
        console.error(`\n   💡 AGENT HINT: 'gh issue edit' is interactive without modification flags. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'pr' && subCmd2 === 'edit') {
      if (!args.includes('--title') && !args.includes('--body') && !args.includes('--add-assignee') && !args.includes('--add-label') && !args.includes('--add-reviewer')) {
        console.error(`\n   💡 AGENT HINT: 'gh pr edit' is interactive without modification flags. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'run' && subCmd2 === 'rerun') {
      if (args.length <= 2) {
        console.error(`\n   💡 AGENT HINT: 'gh run rerun' is interactive without a run ID. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'run' && subCmd2 === 'download') {
      if (args.length <= 2) {
        console.error(`\n   💡 AGENT HINT: 'gh run download' is interactive without a run ID. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'issue' && subCmd2 === 'transfer') {
      if (args.length <= 3) {
        console.error(`\n   💡 AGENT HINT: 'gh issue transfer' is interactive without issue and repo args. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'codespace' && subCmd2 === 'ssh') {
      console.error(`\n   💡 AGENT HINT: 'gh codespace ssh' runs an interactive shell. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    } else if (subCmd1 === 'secret' && subCmd2 === 'set') {
      if (!args.includes('--body') && !payload.stdin) {
        console.error(`\n   💡 AGENT HINT: 'gh secret set' requires '--body' or stdin. Blocking execution to prevent interactive prompt.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'gist' && subCmd2 === 'create') {
      if (args.length <= 2 && !payload.stdin) {
        console.error(`\n   💡 AGENT HINT: 'gh gist create' is interactive without files or stdin. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'pr' && subCmd2 === 'checkout') {
      // gh pr checkout without a PR number/URL/branch opens an interactive picker
      const positionalAfterCheckout = args.filter(a => !a.startsWith('-')).slice(2);
      if (positionalAfterCheckout.length === 0) {
        console.error(`\n   💡 AGENT HINT: 'gh pr checkout' without a PR number opens an interactive picker. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    } else if (subCmd1 === 'browse') {
      console.error(`\n   💡 AGENT HINT: 'gh browse' opens a browser window which is not available in headless mode. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    } else if (subCmd1 === 'label' && subCmd2 === 'create') {
      if (!args.includes('--name') && args.filter(a => !a.startsWith('-')).length <= 2) {
        console.error(`\n   💡 AGENT HINT: 'gh label create' is interactive without a label name. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    }
  }

  if (['az', 'az.cmd', 'az.exe'].includes(cmdBasename)) {
    envOverrides['AZURE_CORE_NO_COLOR'] = '1';
    envOverrides['AZURE_CORE_COLLECT_TELEMETRY'] = '0';
    if (args.includes('interactive') || args.includes('login')) {
      const hasServicePrincipal = args.includes('--service-principal') || args.includes('--identity') || args.includes('--managed-identity');
      if (!hasServicePrincipal && args.includes('login')) {
        console.error(`\n   💡 AGENT HINT: 'az login' without --service-principal/--identity is interactive. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    }
  }

  if (['ansible-vault', 'ansible-vault.exe'].includes(cmdBasename)) {
    if (!args.includes('--vault-password-file') && !args.includes('--vault-id') && !args.includes('--ask-vault-pass')) {
      console.error(`\n   💡 AGENT HINT: 'ansible-vault' without --vault-password-file or --vault-id will prompt for a password. Blocking execution.\n   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, do NOT interrupt your current workflow. Add the issue to your task list to investigate and heal later, and inform the user of the needed self-improvement at the first opportunity. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }
}
