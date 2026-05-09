import type {
  Reporter, Suite, TestCase, TestResult, TestStep,
} from '@playwright/test/reporter';

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭ ';
const SEP  = '─'.repeat(72);

export default class AuditGlideReporter implements Reporter {
  private startedAt = 0;
  private passed  = 0;
  private failed  = 0;
  private skipped = 0;

  onBegin(_config: unknown, suite: Suite) {
    this.startedAt = Date.now();
    const total = suite.allTests().length;
    console.log(`\n${'═'.repeat(72)}`);
    console.log(`  AuditGlide E2E Test Suite — ${total} test${total !== 1 ? 's' : ''}`);
    console.log(`${'═'.repeat(72)}\n`);
  }

  onTestBegin(test: TestCase) {
    process.stdout.write(`  ▶ ${test.title} … `);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed') {
      this.passed++;
      console.log(`${PASS}  (${result.duration}ms)`);
    } else if (result.status === 'skipped') {
      this.skipped++;
      console.log(`${SKIP} SKIPPED`);
    } else {
      this.failed++;
      console.log(`${FAIL}  FAILED (${result.duration}ms)\n`);
      this.printFailureDetails(test, result);
    }
  }

  private printFailureDetails(test: TestCase, result: TestResult) {
    console.log(SEP);
    console.log(`FAILED TEST: ${test.titlePath().join(' › ')}`);
    console.log(SEP);

    // Which step inside the test failed
    const failedStep = this.findFailedStep(result.steps);
    if (failedStep) {
      console.log(`FAILED STEP: ${failedStep.title}`);
    }

    // Error message — strip noisy stack frames, keep the meaningful assertion
    if (result.error) {
      const message = result.error.message ?? '';
      const lines   = message.split('\n');

      console.log('\nERROR:');
      // Print up to 20 lines of the error message
      lines.slice(0, 20).forEach(l => console.log(`  ${l}`));

      // If it's a locator error, extract the selector for clarity
      const selectorMatch = message.match(/locator\('([^']+)'\)/);
      if (selectorMatch) {
        console.log(`\nSELECTOR THAT FAILED: ${selectorMatch[1]}`);
        console.log('TIP: Check the data-testid attribute exists in the rendered page.');
      }

      // Timeout messages
      if (message.includes('Timeout')) {
        console.log('\nTIP: The element may not have appeared in time.');
        console.log('     Check if the API call completed, or if a loading spinner is stuck.');
      }
    }

    // Attachments — screenshot
    const screenshot = result.attachments.find(a => a.name === 'screenshot');
    if (screenshot?.path) {
      console.log(`\nSCREENSHOT: ${screenshot.path}`);
    }

    // Video
    const video = result.attachments.find(a => a.name === 'video');
    if (video?.path) {
      console.log(`VIDEO:      ${video.path}`);
    }

    console.log(SEP + '\n');
  }

  private findFailedStep(steps: TestStep[]): TestStep | undefined {
    for (const step of steps) {
      if (step.error) return step;
      const inner = this.findFailedStep(step.steps);
      if (inner) return inner;
    }
    return undefined;
  }

  onEnd(result: { status: string }) {
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(72)}`);
    console.log(`  RESULTS  ${PASS} ${this.passed} passed  ${FAIL} ${this.failed} failed  ${SKIP} ${this.skipped} skipped`);
    console.log(`  Duration: ${elapsed}s    Status: ${result.status.toUpperCase()}`);
    console.log(`${'═'.repeat(72)}\n`);

    if (this.failed > 0) {
      console.log('  Run  npx playwright show-report  for screenshots, video, and traces.\n');
    }
  }
}
