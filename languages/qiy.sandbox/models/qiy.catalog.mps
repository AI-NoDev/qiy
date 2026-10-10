<?xml version="1.0" encoding="UTF-8"?>
<model ref="r:8a54a797-1664-41d2-b4bc-af7e9b66e19c(qiy.catalog)">
  <persistence version="9" />
  <languages>
    <use id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy" version="0" />
  </languages>
  <imports />
  <registry>
    <language id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy">
      <concept id="720000000000000001" name="qiy.structure.Application" flags="ng" index="qa">
        <child id="72000000000000101" name="database" index="qd" />
        <child id="72000000000000102" name="entities" index="qe" />
        <child id="72000000000000103" name="relations" index="qrelations" />
      </concept>
      <concept id="720000000000000002" name="qiy.structure.DatabaseConfig" flags="nn" index="qf">
        <property id="720000000000000201" name="dialect" index="qg" />
        <property id="720000000000000202" name="orm" index="qh" />
        <child id="72000000000000201" name="extensions" index="qext" />
      </concept>
      <concept id="720000000000000003" name="qiy.structure.DatabaseExtension" flags="nn" index="qextension" />
      <concept id="720000000000000005" name="qiy.structure.Entity" flags="nn" index="qk">
        <property id="720000000000000501" name="tableName" index="ql" />
        <child id="72000000000000501" name="fields" index="qo" />
        <child id="72000000000000502" name="indexes" index="qindexes" />
      </concept>
      <concept id="720000000000000006" name="qiy.structure.Field" flags="nn" index="qp">
        <property id="720000000000000601" name="type" index="qq" />
        <property id="720000000000000602" name="columnName" index="qr" />
        <property id="720000000000000603" name="nullable" index="qs" />
        <property id="720000000000000604" name="primaryKey" index="qt" />
        <property id="720000000000000605" name="unique" index="qu" />
        <property id="720000000000000608" name="extension" index="qx" />
        <property id="720000000000000611" name="dimension" index="ra" />
        <property id="720000000000000612" name="precision" index="rb" />
        <property id="720000000000000613" name="scale" index="rc" />
        <property id="720000000000000614" name="visible" index="qvisible" />
        <property id="720000000000000615" name="listVisible" index="qlistVisible" />
        <property id="720000000000000616" name="formVisible" index="qformVisible" />
        <property id="720000000000000617" name="showVisible" index="qshowVisible" />
        <property id="720000000000000618" name="sortable" index="qsortable" />
        <property id="720000000000000619" name="filterable" index="qfilterable" />
        <property id="720000000000000620" name="label" index="qfieldLabel" />
        <property id="720000000000000621" name="icon" index="qfieldIcon" />
      </concept>
      <concept id="720000000000000007" name="qiy.structure.Index" flags="nn" index="qindex">
        <property id="720000000000000701" name="method" index="qmethod" />
        <property id="720000000000000702" name="unique" index="qunique" />
        <property id="720000000000000704" name="concurrently" index="qconcurrently" />
        <child id="72000000000000701" name="columns" index="qcolumns" />
      </concept>
      <concept id="720000000000000008" name="qiy.structure.IndexColumn" flags="nn" index="qcolumn">
        <property id="720000000000000801" name="fieldName" index="qfield" />
        <property id="720000000000000805" name="opclass" index="qopclass" />
      </concept>
      <concept id="720000000000000011" name="qiy.structure.Relation" flags="nn" index="qrelation">
        <property id="720000000000001101" name="fromEntity" index="qfromEntity" />
        <property id="720000000000001102" name="fromField" index="qfromField" />
        <property id="720000000000001103" name="toEntity" index="qtoEntity" />
        <property id="720000000000001104" name="toField" index="qtoField" />
        <property id="720000000000001105" name="cardinality" index="qcardinality" />
        <property id="720000000000001106" name="onDelete" index="qonDelete" />
      </concept>
    </language>
    <language id="ceab5195-25ea-4f22-9b92-103b95ca8c0c" name="jetbrains.mps.lang.core">
      <concept id="1169194658468" name="jetbrains.mps.lang.core.structure.INamedConcept" flags="ngI" index="TrEIO">
        <property id="1169194664001" name="name" index="TrG5h" />
      </concept>
    </language>
  </registry>
  <node concept="qa" id="110000000000001">
    <property role="TrG5h" value="Catalog" />
    <node concept="qf" id="110000000000002" role="qd">
      <property role="TrG5h" value="main" />
      <property role="qg" value="postgresql" />
      <property role="qh" value="drizzle" />
      <node concept="qextension" id="110000000000003" role="qext">
        <property role="TrG5h" value="pgvector" />
      </node>
    </node>
    <node concept="qk" id="110000000000004" role="qe">
      <property role="TrG5h" value="products" />
      <property role="ql" value="products" />
      <node concept="qp" id="110000000000005" role="qo">
        <property role="TrG5h" value="id" />
        <property role="qq" value="UUID" />
        <property role="qt" value="true" />
      </node>
      <node concept="qp" id="110000000000006" role="qo">
        <property role="TrG5h" value="title" />
        <property role="qq" value="Text" />
      </node>
      <node concept="qp" id="110000000000007" role="qo">
        <property role="TrG5h" value="price" />
        <property role="qq" value="Decimal" />
        <property role="rb" value="12" />
        <property role="rc" value="2" />
      </node>
      <node concept="qp" id="110000000000008" role="qo">
        <property role="TrG5h" value="embedding" />
        <property role="qq" value="Vector" />
        <property role="qx" value="pgvector" />
        <property role="ra" value="1536" />
        <property role="qs" value="true" />
      </node>
      <node concept="qindex" id="110000000000009" role="qindexes">
        <property role="TrG5h" value="products_embedding_hnsw" />
        <property role="qmethod" value="hnsw" />
        <node concept="qcolumn" id="110000000000010" role="qcolumns">
          <property role="qfield" value="embedding" />
          <property role="qopclass" value="vector_cosine_ops" />
        </node>
      </node>
      <node concept="qindex" id="110000000000011" role="qindexes">
        <property role="TrG5h" value="products_title_idx" />
        <property role="qmethod" value="btree" />
        <node concept="qcolumn" id="110000000000012" role="qcolumns">
          <property role="qfield" value="title" />
        </node>
      </node>
    </node>
  </node>
</model>
