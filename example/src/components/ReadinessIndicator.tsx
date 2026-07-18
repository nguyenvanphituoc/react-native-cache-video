import * as React from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  getServerState,
  subscribeServerState,
  type ServerState,
} from 'react-native-cache-video';

// U2 readiness indicator (ux-behavior RULE-01..04): renders the cache layer's
// S1 state — driven ONLY by subscribeServerState, whose immediate delivery
// makes a late-mounted instance show `ready :<port>` right away (RULE-02,
// the visible issue #6 proof).

// affordance manifest states for test_id "readiness-indicator"
const DATA_STATE: Record<ServerState['status'], string> = {
  idle: 'idle',
  starting: 'loading',
  ready: 'success',
  failed: 'error',
};

function labelOf(state: ServerState): string {
  switch (state.status) {
    case 'idle':
      return 'idle';
    case 'starting':
      return 'starting…';
    case 'ready':
      return `ready :${state.port}`;
    case 'failed':
      return 'failed';
  }
}

function ReadinessIndicator({
  testID = 'readiness-indicator',
  prefix = 'cache server',
}: {
  testID?: string;
  prefix?: string;
}) {
  // initial snapshot by query, every transition by subscription — never a
  // timer, so `ready` can only appear after the confirmed start (RULE-01)
  const [state, setState] = React.useState<ServerState>(getServerState);

  React.useEffect(() => subscribeServerState(setState), []);

  return (
    <Text
      testID={testID}
      role="status"
      style={styles.indicator}
      {...{ 'data-state': DATA_STATE[state.status] }}
    >
      {`${prefix}: ${labelOf(state)}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  indicator: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    fontSize: 13,
    color: '#333',
    backgroundColor: '#eee',
  },
});

export default ReadinessIndicator;
