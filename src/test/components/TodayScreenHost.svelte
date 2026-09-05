<script lang="ts">
  import TodayScreen from "@ui/today/TodayScreen.svelte";
  import AppContextTestShell from "@test/AppContextTestShell.svelte";
  import { loadedAppContext } from "@test/fixtures/app-context";
  import type { AppContextData } from "@lib/context";

  type LoadedAppContext = Extract<AppContextData, { loaded: true }>;
  type Props = { data?: LoadedAppContext };
  let { data = loadedAppContext() }: Props = $props();
</script>

<AppContextTestShell {data}>
  <TodayScreen />
</AppContextTestShell>
