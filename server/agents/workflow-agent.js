/**
 * WORKFLOW AGENT
 * Records and guides users through website workflows
 * 
 * Training Mode: Records user actions (clicks, forms, navigation)
 * Help Mode: Guides users based on recorded workflows
 * 
 * Tools:
 * - start_training: Begin recording a workflow
 * - record_step: Record a single step (click, fill, navigate)
 * - finish_training: Save the completed workflow
 * - list_workflows: List all trained workflows
 * - find_workflow: Find workflow by name or description
 * - get_workflow_step: Get specific step details
 * - validate_current_page: Check if user is on correct page for workflow
 * - suggest_next_step: Suggest next action based on current DOM state
 */

const fs = require('fs');
const path = require('path');

class WorkflowAgent {
  constructor(workflowsDir = path.join(__dirname, '../data/workflows')) {
    this.workflowsDir = workflowsDir;
    this.ensureWorkflowsDir();
    
    // Active training session
    this.trainingSession = null;
    
    // Loaded workflows cache
    this.workflows = new Map();
    this.loadWorkflows();
  }

  ensureWorkflowsDir() {
    if (!fs.existsSync(this.workflowsDir)) {
      fs.mkdirSync(this.workflowsDir, { recursive: true });
    }
  }

  loadWorkflows() {
    try {
      const files = fs.readdirSync(this.workflowsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(this.workflowsDir, file);
        const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this.workflows.set(workflow.id, workflow);
      }
      console.log(`   📚  Loaded ${this.workflows.size} workflow(s)`);
    } catch (err) {
      console.warn('[WorkflowAgent] Failed to load workflows:', err.message);
    }
  }

  /**
   * Start a new training session
   */
  startTraining(workflowName, description, startUrl) {
    const id = `wf_${Date.now()}`;
    this.trainingSession = {
      id,
      name: workflowName,
      description,
      startUrl,
      steps: [],
      createdAt: new Date().toISOString(),
      status: 'recording'
    };

    return {
      success: true,
      sessionId: id,
      message: `Training started for "${workflowName}". Record each step.`
    };
  }

  /**
   * Record a single workflow step
   */
  recordStep(stepData) {
    if (!this.trainingSession) {
      return { success: false, error: 'No active training session. Call start_training first.' };
    }

    const step = {
      stepNumber: this.trainingSession.steps.length + 1,
      timestamp: new Date().toISOString(),
      type: stepData.type, // 'navigate', 'click', 'fill', 'select', 'wait', 'verify'
      description: stepData.description,
      
      // DOM context
      selector: stepData.selector || null,
      elementText: stepData.elementText || null,
      elementType: stepData.elementType || null,
      
      // Navigation
      url: stepData.url || null,
      urlPattern: stepData.urlPattern || null,
      
      // Form data
      fieldName: stepData.fieldName || null,
      fieldValue: stepData.fieldValue || null,
      
      // Validation
      validation: stepData.validation || null, // { required: true, pattern: '...', minLength: 5 }
      errorSelector: stepData.errorSelector || null,
      
      // DOM snapshot (minimal)
      domSnapshot: stepData.domSnapshot || null,
      
      // Screenshot reference
      screenshot: stepData.screenshot || null
    };

    this.trainingSession.steps.push(step);

    return {
      success: true,
      stepNumber: step.stepNumber,
      message: `Step ${step.stepNumber} recorded: ${step.description}`
    };
  }

  /**
   * Finish training and save workflow
   */
  finishTraining() {
    if (!this.trainingSession) {
      return { success: false, error: 'No active training session.' };
    }

    const workflow = {
      ...this.trainingSession,
      status: 'completed',
      completedAt: new Date().toISOString(),
      totalSteps: this.trainingSession.steps.length
    };

    // Save to file
    const filePath = path.join(this.workflowsDir, `${workflow.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');

    // Cache it
    this.workflows.set(workflow.id, workflow);

    const result = {
      success: true,
      workflowId: workflow.id,
      name: workflow.name,
      totalSteps: workflow.totalSteps,
      message: `Workflow "${workflow.name}" saved with ${workflow.totalSteps} steps.`
    };

    this.trainingSession = null;
    return result;
  }

  /**
   * List all trained workflows
   */
  listWorkflows() {
    const workflows = Array.from(this.workflows.values()).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      totalSteps: w.totalSteps,
      startUrl: w.startUrl,
      createdAt: w.createdAt
    }));

    return {
      success: true,
      workflows,
      count: workflows.length
    };
  }

  /**
   * Find workflow by name or keyword
   */
  findWorkflow(query) {
    const lowerQuery = query.toLowerCase();
    const matches = Array.from(this.workflows.values()).filter(w => 
      w.name.toLowerCase().includes(lowerQuery) ||
      w.description?.toLowerCase().includes(lowerQuery)
    );

    if (matches.length === 0) {
      return {
        success: false,
        message: `No workflow found matching "${query}"`
      };
    }

    return {
      success: true,
      workflows: matches.map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        totalSteps: w.totalSteps,
        startUrl: w.startUrl
      })),
      count: matches.length
    };
  }

  /**
   * Get detailed workflow with all steps
   */
  getWorkflow(workflowId) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return { success: false, error: 'Workflow not found' };
    }

    return {
      success: true,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        startUrl: workflow.startUrl,
        totalSteps: workflow.totalSteps,
        steps: workflow.steps.map(s => ({
          stepNumber: s.stepNumber,
          type: s.type,
          description: s.description,
          selector: s.selector,
          url: s.url,
          validation: s.validation
        }))
      }
    };
  }

  /**
   * Get a specific step from a workflow
   */
  getWorkflowStep(workflowId, stepNumber) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return { success: false, error: 'Workflow not found' };
    }

    const step = workflow.steps.find(s => s.stepNumber === stepNumber);
    if (!step) {
      return { success: false, error: `Step ${stepNumber} not found` };
    }

    return {
      success: true,
      step: {
        stepNumber: step.stepNumber,
        type: step.type,
        description: step.description,
        selector: step.selector,
        elementText: step.elementText,
        url: step.url,
        fieldName: step.fieldName,
        validation: step.validation,
        errorSelector: step.errorSelector
      }
    };
  }

  /**
   * Validate if current page matches expected workflow step
   */
  validateCurrentPage(workflowId, stepNumber, currentUrl, currentDom) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return { success: false, error: 'Workflow not found' };
    }

    const step = workflow.steps.find(s => s.stepNumber === stepNumber);
    if (!step) {
      return { success: false, error: `Step ${stepNumber} not found` };
    }

    const validation = {
      stepNumber,
      expectedUrl: step.url || step.urlPattern,
      currentUrl,
      urlMatches: false,
      expectedElement: step.selector,
      elementExists: false,
      isValid: false,
      issues: []
    };

    // Check URL
    if (step.url) {
      validation.urlMatches = currentUrl.includes(step.url);
    } else if (step.urlPattern) {
      try {
        const regex = new RegExp(step.urlPattern);
        validation.urlMatches = regex.test(currentUrl);
      } catch {
        validation.urlMatches = false;
      }
    }

    if (!validation.urlMatches && (step.url || step.urlPattern)) {
      validation.issues.push(`Wrong page. Expected URL: ${step.url || step.urlPattern}`);
    }

    // Check element exists
    if (step.selector && currentDom) {
      validation.elementExists = currentDom.includes(step.selector) || 
                                  (step.elementText && currentDom.includes(step.elementText));
      if (!validation.elementExists) {
        validation.issues.push(`Element not found: ${step.selector}`);
      }
    }

    validation.isValid = validation.issues.length === 0;

    return {
      success: true,
      validation
    };
  }

  /**
   * Suggest next step based on current state
   */
  suggestNextStep(workflowId, currentStepNumber) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return { success: false, error: 'Workflow not found' };
    }

    const currentStep = workflow.steps.find(s => s.stepNumber === currentStepNumber);
    const nextStep = workflow.steps.find(s => s.stepNumber === currentStepNumber + 1);

    if (!nextStep) {
      return {
        success: true,
        isComplete: true,
        message: `Workflow "${workflow.name}" complete! You've finished all ${workflow.totalSteps} steps.`
      };
    }

    // Build suggestion
    let suggestion = `**Step ${nextStep.stepNumber} of ${workflow.totalSteps}**: ${nextStep.description}\n\n`;

    switch (nextStep.type) {
      case 'navigate':
        suggestion += `Go to: ${nextStep.url}`;
        break;
      case 'click':
        suggestion += `Click: ${nextStep.elementText || nextStep.selector}`;
        break;
      case 'fill':
        suggestion += `Fill field: ${nextStep.fieldName}`;
        if (nextStep.validation) {
          if (nextStep.validation.required) suggestion += ' (required)';
          if (nextStep.validation.pattern) suggestion += ` (format: ${nextStep.validation.pattern})`;
        }
        break;
      case 'select':
        suggestion += `Select option in: ${nextStep.fieldName}`;
        break;
      case 'verify':
        suggestion += `Verify: ${nextStep.description}`;
        break;
      default:
        suggestion += nextStep.description;
    }

    return {
      success: true,
      isComplete: false,
      currentStep: currentStepNumber,
      nextStep: {
        stepNumber: nextStep.stepNumber,
        type: nextStep.type,
        description: nextStep.description,
        selector: nextStep.selector,
        url: nextStep.url,
        validation: nextStep.validation
      },
      suggestion,
      progress: `${currentStepNumber}/${workflow.totalSteps}`
    };
  }

  /**
   * Get OpenAI tool definitions
   */
  getTools() {
    return [
      {
        name: 'start_training',
        handler: (args) => this.startTraining(args.workflow_name, args.description, args.start_url),
        definition: {
          type: 'function',
          function: {
            name: 'start_training',
            description: 'Start recording a new workflow. User will perform actions and each will be recorded.',
            parameters: {
              type: 'object',
              properties: {
                workflow_name: {
                  type: 'string',
                  description: 'Name of the workflow (e.g., "Create Invoice", "User Registration")'
                },
                description: {
                  type: 'string',
                  description: 'Brief description of what this workflow does'
                },
                start_url: {
                  type: 'string',
                  description: 'Starting URL/page for this workflow'
                }
              },
              required: ['workflow_name', 'start_url']
            }
          }
        }
      },
      {
        name: 'record_step',
        handler: (args) => this.recordStep(args),
        definition: {
          type: 'function',
          function: {
            name: 'record_step',
            description: 'Record a single step in the workflow being trained.',
            parameters: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['navigate', 'click', 'fill', 'select', 'wait', 'verify'],
                  description: 'Type of action'
                },
                description: {
                  type: 'string',
                  description: 'Human-readable description of this step'
                },
                selector: {
                  type: 'string',
                  description: 'CSS selector for the element (if applicable)'
                },
                elementText: {
                  type: 'string',
                  description: 'Visible text of the element (for identification)'
                },
                url: {
                  type: 'string',
                  description: 'URL navigated to (for navigate type)'
                },
                fieldName: {
                  type: 'string',
                  description: 'Field label or name (for fill/select type)'
                },
                validation: {
                  type: 'object',
                  description: 'Validation rules (e.g., { required: true })'
                },
                domSnapshot: {
                  type: 'string',
                  description: 'Minimal DOM context (optional)'
                }
              },
              required: ['type', 'description']
            }
          }
        }
      },
      {
        name: 'finish_training',
        handler: () => this.finishTraining(),
        definition: {
          type: 'function',
          function: {
            name: 'finish_training',
            description: 'Complete the training session and save the workflow.',
            parameters: { type: 'object', properties: {} }
          }
        }
      },
      {
        name: 'list_workflows',
        handler: () => this.listWorkflows(),
        definition: {
          type: 'function',
          function: {
            name: 'list_workflows',
            description: 'List all trained workflows available.',
            parameters: { type: 'object', properties: {} }
          }
        }
      },
      {
        name: 'find_workflow',
        handler: (args) => this.findWorkflow(args.query),
        definition: {
          type: 'function',
          function: {
            name: 'find_workflow',
            description: 'Search for a workflow by name or keywords.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (workflow name or keywords)'
                }
              },
              required: ['query']
            }
          }
        }
      },
      {
        name: 'get_workflow',
        handler: (args) => this.getWorkflow(args.workflow_id),
        definition: {
          type: 'function',
          function: {
            name: 'get_workflow',
            description: 'Get complete details of a specific workflow including all steps.',
            parameters: {
              type: 'object',
              properties: {
                workflow_id: {
                  type: 'string',
                  description: 'Workflow ID'
                }
              },
              required: ['workflow_id']
            }
          }
        }
      },
      {
        name: 'suggest_next_step',
        handler: (args) => this.suggestNextStep(args.workflow_id, args.current_step),
        definition: {
          type: 'function',
          function: {
            name: 'suggest_next_step',
            description: 'Suggest the next step in a workflow based on current progress.',
            parameters: {
              type: 'object',
              properties: {
                workflow_id: {
                  type: 'string',
                  description: 'Workflow ID'
                },
                current_step: {
                  type: 'number',
                  description: 'Current step number (0 if just starting)'
                }
              },
              required: ['workflow_id', 'current_step']
            }
          }
        }
      },
      {
        name: 'validate_current_page',
        handler: (args) => this.validateCurrentPage(
          args.workflow_id,
          args.step_number,
          args.current_url,
          args.current_dom
        ),
        definition: {
          type: 'function',
          function: {
            name: 'validate_current_page',
            description: 'Check if user is on the correct page/state for a workflow step.',
            parameters: {
              type: 'object',
              properties: {
                workflow_id: {
                  type: 'string',
                  description: 'Workflow ID'
                },
                step_number: {
                  type: 'number',
                  description: 'Step number to validate against'
                },
                current_url: {
                  type: 'string',
                  description: 'Current page URL'
                },
                current_dom: {
                  type: 'string',
                  description: 'Current DOM structure or key elements (simplified)'
                }
              },
              required: ['workflow_id', 'step_number', 'current_url']
            }
          }
        }
      }
    ];
  }

  /**
   * Execute a tool by name
   */
  async executeTool(toolName, args) {
    const tool = this.getTools().find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Unknown workflow tool: ${toolName}`);
    }
    return tool.handler(args);
  }
}

module.exports = WorkflowAgent;
