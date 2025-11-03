import {ProgramState} from "./renkon-core.js";

//
// oncePerFrame that accumlates the changes for this cycle.
// returnValues for func for now would say what are the values that are interests of view
// can we figure out the events that the model part needs by looking at


function decls(funcStr, realm) {
  const state = new ProgramState(0);

  const {output} = state.getFunctionBody(funcStr);

  state.setupProgram([output]);

  const types = state.types;

  const decls = state.findDecls(output);
  const check = (d) => d.decls.length > 0 && realm.get(d.decls[0]) === "Model";

  const modelDecls = decls.filter((decl) => check(decl));
  const viewDecls = decls.filter((decl) => !check(decl));
  const modelState = new ProgramState(0);
  modelState.setLog(() => {});
  modelState.setupProgram([modelDecls.map(m => m.code).join("\n")]);
  const viewState = new ProgramState(0);
  viewState.setLog(() => {});
  viewState.setupProgram([viewDecls.map(m => m.code).join("\n")]);

  const modelVarsArray = [];
  const modelUsesArray = [];
  for (const [id, modelNode] of modelState.nodes) {
    if (!/^_?[0-9]/.exec(id)) {
      modelVarsArray.push(id);
    }
    for (const input of modelNode.inputs) {
      if (!/^_?[0-9]/.exec(input)) {
        modelUsesArray.push(input);
      }
    }
  }

  const viewVarsArray = [];
  const viewUsesArray = [];
  for (const [id, viewNode] of viewState.nodes) {
    if (!/^_?[0-9]/.exec(id)) {
      viewVarsArray.push(id);
    }
    for (const input of viewNode.inputs) {
      if (!/^_?[0-9]/.exec(input)) {
        viewUsesArray.push(input);
      }
    }
  }

  const viewToModel = new Set(viewVarsArray).intersection(new Set(modelUsesArray));
  const modelToView = new Set(modelVarsArray).intersection(new Set(viewUsesArray));

  return {modelDecls, viewDecls, viewToModel, modelToView, types, realm};
}

function strs(decls) {
  const {modelDecls, viewDecls, types, modelToView, viewToModel} = decls;

  const viewEvents = [];
  for (const viewDecl of viewToModel) {
    const type = types.get(viewDecl) === "Event" ? "Events" : "Behaviors";
    viewEvents.push(`const ${viewDecl} = ${type}.receiver();`);
  }

  const modelEvents = [];
  for (const modelDecl of modelToView) {
    const type = types.get(modelDecl) === "Event" ? "Events" : "Behaviors";
    modelEvents.push(`const ${modelDecl} = ${type}.receiver();`);
  }

  const modelNodeStr = modelDecls.map(m => m.code).join("\n");
  const viewEventsStr = viewEvents.join("\n");

  const viewNodeStr = viewDecls.map(m => m.code).join("\n");
  const modelEventsStr = modelEvents.join("\n");

  return {modelNodeStr, viewEventsStr, viewNodeStr, modelEventsStr};
}

export function splitStrs(func, realm) {
  const funcStr = typeof func === "function" ? func.toString() : func;
  const d = decls(funcStr, realm);
  return strs(d);
}

export function croquetify(func, appName, realm) {
  const funcStr = typeof func === "function" ? func.toString() : func;
  const modelName = appName + "Model";
  const viewName = appName + "View";

  const modelStr = `
class ${modelName} extends Croquet.Model {
  init(_options, persistent) {
    super.init(_options, persistent);

    this.$lastPublishTime = this.now();
    this.$changedKeys = new Set();

    this.funcStr = funcStr;
    const nodes = decls(funcStr, realm);
    this.realm = nodes.realm;
    this.viewToModel = nodes.viewToModel;
    this.modelToView = nodes.modelToView;
    const {modelNodeStr, viewEventsStr, viewNodeStr, modelEventsStr} = strs(nodes);

    this.timerNames = new Set();
    this.programState = new ProgramState(0, this);
    this.programState.setupProgram([modelNodeStr, viewEventsStr]);
    this.programState.options = {once: true};
    this.programState.evaluate(this.now());

    this.initCallFuture();

    this.subscribe(this.id, "viewMessage", this.viewMessage);
    this.subscribe(this.sessionId, "view-join", this.viewJoin);
    this.subscribe(this.sessionId, "view-exit", this.viewExit);
  }

  scheduleTimer(timerId, timerEvent) {
    console.log("scheduleTimer");
    if (this.timerNames.has(timerId)) {return;}
    this.timerNames.add(timerId);
  }

  initCallFuture() {
    [...this.programState.streams].forEach(([id, stream]) => {
      if (stream.constructor.name === "TimerEvent") {
        this.timerNames.add(id);
        this.invokeTimer(stream.interval);
      }
    });
  }

  invokeTimer(interval) {
    this.future(interval).invokeTimer(interval);
    this.timer();
  }

  viewMessage(data) {
    const now = this.now();
    const {name, value} = data;

    if (name === undefined || value === undefined) {return;}
    this.programState.registerEvent(name, value);

    this.run(now);
  }

  timer() {
    // console.log("timer", this.now());

    const now = this.now();
    this.run(now);
  }

  viewJoin(viewId) {
    this.programState.registerEvent("viewJoin", viewId);
    const now = this.now();
    this.run(now);
  }

  viewExit(viewId) {
    this.programState.registerEvent("viewExit", viewId);
    const now = this.now();
    this.run(now);
  }

  run(now) {
    if (this.$lastPublishTime !== now) {
      this.$changedKeys = new Set();
      this.$lastPublishTime = now;
    }

    window.modelNetwork = this.programState;
    if (!this.programState.app) {
      // console.log("reinstate app");
      this.programState.app = this;
    }

    let changedKeys = this.programState.evaluate(now);
    changedKeys = this.$changedKeys.union(changedKeys);
    this.$changedKeys = changedKeys.intersection(this.modelToView);
    this.publish(this.id, "modelUpdate", this.$changedKeys);
  }

  static types() {
    return {
      ProgramState: {
        cls: ProgramState,
        write: (ps) => {
          return {
            scripts: ps.scripts,
            resolved: ps.resolved,
            scratch: ps.scratch,
            time: ps.time
          };
        },
        read: (obj) => {
          // console.log("read");
          let ps = new ProgramState(0);
          ps.setupProgram(obj.scripts);
          ps.options = {once: true};
          ps.evaluate(obj.time);
          ps.resolved = obj.resolved;
          ps.scratch = obj.scratch;
          return ps;
        }
      }
    }
  }
}
`.trim();

  const viewStr = `
class ${viewName} extends Croquet.View {
  constructor(model) {
    super(model);
    this.model = model;

    const nodes = decls(model.funcStr, this.model.realm);
    const {modelNodeStr, viewEventsStr, viewNodeStr, modelEventsStr} = strs(nodes);
    this.programState = new ProgramState(0, this);
    this.programState.setupProgram([viewNodeStr, modelEventsStr]);
    this.programState.announcer = (varName, value) => this.announcer(varName, value);
    window.viewNetwork = this.programState;
    this.programState.evaluate(this.now());

    this.initViewState();
    this.subscribe(this.model.id, {event: "modelUpdate", handling: "oncePerFrame"}, this.modelUpdate);
  }

  initViewState() {
    this.modelUpdate(this.model.modelToView);
  }

  modelUpdate(keys) {
    for (const key of keys) {
      const value = this.model.programState.resolved.get(key);
      if (value && value.value !== undefined) {
        this.programState.registerEvent(key, value.value);
      }
    }
  }

  announcer(varName, value) {
    if (this.model.viewToModel.has(varName)) {
      this.publish(this.model.id, "viewMessage", {name: varName, value: value});
    }
  }
}`.trim();

  const result = new Function(
    "funcStr", "realm", "ProgramState", "Croquet", "decls", "strs",
    `return {model: ${modelStr}, view: ${viewStr}}`
  )(funcStr, realm, ProgramState, Croquet, decls, strs);

  return result;
}

export function toFunction(code, name) {
  return `
function ${name}({}) {
${code.join("\n")}

return {}
}`.trim();
}

export function loader(docName, options = {}) {
  const myFetch = options.fetch || fetch;

  myFetch(docName).then((resp) => resp.text()).then((result) => {
    const index = result.indexOf("{__codeMap: true, value:");
    let code;
    if (index < 0) {
      console.log("unknown type of data");
      return;
    }

    let data1 = JSON.parse(result.slice(0, index));
    let windowEnabledMap = new Map();
    if (data1?.windowEnabled?.map?.values) {
      windowEnabledMap = new Map(data1?.windowEnabled?.map?.values);
    }
    let windowTypesMap = new Map();
    if (data1?.windowTypes?.map?.values) {
      windowTypesMap = new Map(data1?.windowTypes?.map?.values);
    }

    let titlesMap = new Map();
    if (data1?.titles?.map?.values) {
      titlesMap = new Map(data1?.titles?.map?.values);
    }

    const data2 = result.slice(index);
    const array = eval("(" + data2 + ")");
    code = array.value;
    const croquet = code.find(([id, _obj]) => titlesMap.get(id).title === "Croquet")?.[1];
    code = code.filter((pair) => (
      !windowEnabledMap.get(pair[0]) ||
        (windowEnabledMap.get(pair[0]).enabled && windowTypesMap.get(pair[0]) === "code" &&
         titlesMap.get(pair[0]).title !== "Croquet")
    ));

    function trimParenthesis(str) {
      let match = /^\(+([^()]+)\)+$/m.exec(str);
      if (!match) return str;
      return match[1];
    }

    const trimmed = trimParenthesis(croquet);
    const {name, realm, appParameters} = JSON.parse(trimmed);
    code = code.map(((pair) => pair[1]));
    const {model, view} = croquetify(toFunction(code, name), name, new Map(realm.model.map((key) => [key, "Model"])), Croquet);
    model.register(model.name);

    window.Croquet.Session.join({...appParameters, ...options.appParameters, model, view});
  });
}
/* globals Croquet */
