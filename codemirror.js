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
  console.log("apply", events, viewId, view.state.doc.length);
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

  modelConfig(doc, compartment, selection) {
    this.croquetExt = compartment;
    return {
      doc: doc || "",
      selection,
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
          const {model, doc, selection} = obj;
          const text = CodeMirror.state.Text.of(doc);
          let sel;
          if (selection.ranges) {
            sel = CodeMirror.state.EditorSelection.fromJSON(selection);
          } else {
            sel = CodeMirror.state.EditorSelection.single(0, 0);
          }
          const editor = new window.CodeMirror.EditorView(model.modelConfig(text, model.croquetExt, sel));
          model.setupCroquet(editor, model);
          return editor;
        },
        write: (obj) => {
          return {model: obj.croquetModel, doc: obj.viewState.state.doc.toJSON(), selection: obj.viewState.state.selection.toJSON()};
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
    this.editor = new CodeMirror.EditorView(this.viewConfig(model.editor.state.doc, newCompartment(), model.editor.state.selection));
    console.log("view init", this.viewId, model.editor.state.doc.length);
    this.setupCroquet(this.editor, this);
    this.subscribe(this.model.id, "update", this.updated);
    this.subscribe(this.viewId, "synced", this.synced);
    this.viewSynced = false;
  }

  detach() {
    super.detach();
  }

  viewConfig(doc, compartment, selection) {
    this.croquetExt = compartment;
    return {
      doc: doc || "",
      selection,
      extensions: [
        CodeMirror.basicSetup,
        CodeMirror.EditorView.lineWrapping,
        this.croquetExt.of([]),
      ],
    }
  }

  synced(value) {
    this.viewSynced = value;
    console.log("synced", this.viewId, value);
    if (value === true) {
      const modelJSON = this.model.editor.viewState.state.doc.toJSON();
      const viewJSON = this.editor.viewState.state.doc.toJSON();
      if (JSON.stringify(modelJSON) !== JSON.stringify(viewJSON)) {
        this.editor.state.update({
          changes: {
            from: 0,
            to: this.editor.state.doc.length,
            insert: this.model.editor.state.doc.toString()
          }
        });
      }
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
    this.publish(this.model.id, "edit", events);
  }

  update(update) {
    console.log("codemirror update", update);
    const events = this.transationsToEvents(update.transactions);
    if (events) {
      this.publishCmTransactions(events);
    }
  }

  updated(data) {
    const view = this.editor;
    if (!this.viewSynced) {return;}
    applyCrEventToCm(view, data, this.viewId);
  };

  static create(Renkon, modelId) {
    const view = new this(Renkon.app.model.getModel(modelId));
    return view;
  }
}

/* globals Croquet */
