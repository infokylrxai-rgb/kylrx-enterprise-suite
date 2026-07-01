const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logPath = 'C:\\Users\\Admin\\.gemini\\antigravity-ide\\brain\\652afe2b-da64-4a88-b5d3-06699723b944\\.system_generated\\logs\\transcript.jsonl';

const fileStream = fs.createReadStream(logPath);
const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity
});

const steps = [];

rl.on('line', (line) => {
  try {
    const step = JSON.parse(line);
    steps.push(step);
  } catch (e) {}
});

rl.on('close', () => {
  console.log(`Read ${steps.length} steps.`);
  // Find USER_INPUT steps and print them and the subsequent model steps
  const userSteps = steps.filter(s => s.type === 'USER_INPUT');
  console.log(`Found ${userSteps.length} user inputs.`);
  
  // Let's print the last 6 user inputs and their corresponding model responses
  const lastN = 6;
  const recentUserSteps = userSteps.slice(-lastN);
  
  recentUserSteps.forEach((us, index) => {
    console.log(`\n========================================`);
    console.log(`USER REQUEST #${index + 1} (Step ${us.step_index}):`);
    console.log((us.content || '').substring(0, 300));
    
    // find model response following this step
    const nextSteps = steps.filter(s => s.step_index > us.step_index && s.step_index < us.step_index + 10);
    const planResponse = nextSteps.find(s => s.source === 'MODEL' && s.type === 'PLANNER_RESPONSE');
    if (planResponse) {
      console.log(`--- MODEL PLANNER RESPONSE ---`);
      console.log((planResponse.content || '').substring(0, 500) + '...');
    }
  });
});
