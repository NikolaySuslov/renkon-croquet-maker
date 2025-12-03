import {CodeMirror} from "./renkon-web.js";
const reconcileAnnotationType = CodeMirror.state.Annotation.define();

const newCompartment = () => new CodeMirror.state.Compartment();

function handleEvent(event, _state) {
  function handleInsert(event) {
    const index = event.fromA;
    return [{ from: index, to: event.toA, insert: event.text }];
  }
  function handleSplice(event) {
    const index = event.index;
    return [{ from: index, insert: event.value }];
  }
  function handleDel(event) {
    const length = event.length || 1;
    const index = event.index;
    return [{ from: index, to: index + length }];
  }

  if (event.action === "insert") {
    return handleInsert(event);
  } else if (event.action === "splice") {
    return handleSplice(event);
  } else if (event.action === "del") {
    return handleDel(event);
  } else {
    return null;
  }
}

function applyCrEventToCm(view, events, viewId) {
  let selection = view.state.selection;
  for (const event of events) {
    if (viewId !== undefined && viewId === event.viewId) {continue;}
    const changeSpec = handleEvent(event, view.state);
    if (changeSpec != null) {
      const changeSet = CodeMirror.state.ChangeSet.of(changeSpec, view.state.doc.length, "\n");
      selection = selection.map(changeSet, 1);
      view.dispatch({
        changes: changeSet,
        annotations: reconcileAnnotationType.of({}),
      });
    }
  }
  view.dispatch({
    selection,
    annotations: reconcileAnnotationType.of({}),
  });
};

export class CodeMirrorModel extends Croquet.Model {
  init(options) {
    super.init();
    this.editor = new CodeMirror.EditorView(this.modelConfig(options.doc, newCompartment()));
    this.setupCroquet(this.editor, this);
    this.subscribe(this.id, "edit", "changed")
  }

  modelConfig(doc, compartment) {
    this.croquetExt = compartment;
    return {
      doc: doc || "",
      extensions: [
        this.croquetExt.of([]),
      ]
    };
  }

  setupCroquet(editor, model) {
    editor.croquetModel = model;
    editor.dispatch({
      effects: this.croquetExt.reconfigure([
        CodeMirror.view.ViewPlugin.define(_view => model)
      ])
    });
  }

  changed(data) {
    const view = this.editor;
    console.log('changed', view);
    applyCrEventToCm(view, data);
    
    this.publish(this.id, "update", data);
  }

  destroy() {
    this.unsubscribe(this.id, "edit", "changed");
  }

  static types() {
    return {
      AnnotationType: {
        cls: CodeMirror.state.AnnotationType,
        read: (_obj) => reconcileAnnotationType,
        write: () => ''
      },
      Compartment: {
        cls: CodeMirror.state.Compartment,
        read: (_obj) => newCompartment(),
        write: () => ''
      },
      EditorView: {
        cls: CodeMirror.EditorView,
        read: (obj) => {
          const {model, doc} = obj;
          const text = CodeMirror.state.Text.of(doc);
          const editor = new window.CodeMirror.EditorView(model.modelConfig(text, model.croquetExt));
          model.setupCroquet(editor, model);
          return editor;
        },
        write: (obj) => {
          return {model: obj.croquetModel, doc: obj.viewState.state.doc.toJSON()};
        }
      }
    }
  }
}

CodeMirrorModel.register("CodeMirrorModel");
window.CodeMirrorModel = CodeMirrorModel;

export class CodeMirrorView extends Croquet.View {
  constructor(model) {
    super(model);
    this.model = model;
    this.editor = new CodeMirror.EditorView(this.viewConfig(model.editor.state.doc, newCompartment()));
    this.setupCroquet(this.editor, this);
    this.subscribe(this.model.id, "update", "updated");
  }

  viewConfig(doc, compartment) {
    this.croquetExt = compartment;
    return {
      doc: doc || "",
      extensions: [
        CodeMirror.basicSetup,
        CodeMirror.EditorView.lineWrapping,
        this.croquetExt.of([]),
      ],
    }
  }

  setupCroquet(editor, view) {
    editor.dispatch({
      effects: this.croquetExt.reconfigure([
        CodeMirror.view.ViewPlugin.define(_view => view)
      ])
    });
  }

  isReconcileTx(tr) {return !!tr.annotation(reconcileAnnotationType)};

  transationsToEvents(transactions) {
    const transactionsWithChanges = transactions.filter(tr => !this.isReconcileTx(tr) && !tr.changes.empty);
    if (transactionsWithChanges.length === 0) {
      return;
    }

    const result = [];

    transactionsWithChanges.forEach((tr) => {
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        result.push({action: "insert", fromA, fromB, toA, toB, text: inserted.toString(), viewId: this.viewId});
      });
    });
    
    console.log("translate", result);
    return result;
  }

  publishCmTransactions(events) {
    console.log("publish", this.model.id, "edit", events);
    this.publish(this.model.id, "edit", events);
  }

  update(update) {
    const events = this.transationsToEvents(update.transactions);
    if (events) {
      this.publishCmTransactions(events);
    }
  }

  updated(data) {
    console.log('change', data);
    const view = this.editor;
    applyCrEventToCm(view, data, this.viewId);
  };

  static create(Renkon, modelId) {
    const view = new this(Renkon.app.model.getModel(modelId));
    return view;
  }
}

/* globals Croquet */
