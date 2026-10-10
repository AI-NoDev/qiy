<?xml version="1.0" encoding="UTF-8"?>
<model ref="r:7a4f542f-f704-4620-9ab1-42db940fa8a5(qiy.relations)">
  <persistence version="9" />
  <languages>
    <use id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy" version="0" />
  </languages>
  <imports />
  <registry>
    <language id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy">
      <concept id="720000000000000001" name="qiy.structure.Application" flags="ng" index="qa">
        <property id="720000000000000104" name="apiClient" index="qapiClient" />
        <child id="72000000000000101" name="database" index="qd" />
        <child id="72000000000000102" name="entities" index="qe" />
        <child id="72000000000000103" name="relations" index="qrelations" />
        <child id="72000000000000105" name="elysia" index="qelysia" />
        <child id="72000000000000106" name="storage" index="qstorage" />
        <child id="72000000000000107" name="auth" index="qauth" />
        <child id="72000000000000108" name="scopes" index="qscopes" />
        <child id="72000000000000109" name="menuGroups" index="qmenuGroups" />
        <child id="72000000000000110" name="dashboardMetrics" index="qdashboards" />
        <child id="72000000000000111" name="enums" index="qenums" />
        <child id="72000000000000112" name="workflows" index="qworkflows" />
      </concept>
      <concept id="720000000000000023" name="qiy.structure.WorkflowConfig" flags="nn" index="qworkflowConfig" />
      <concept id="720000000000000016" name="qiy.structure.AuthConfig" flags="nn" index="qauthConfig">
        <property id="720000000000001601" name="provider" index="qauthProvider" />
        <property id="720000000000001602" name="userEntity" index="qauthUser" />
        <property id="720000000000001603" name="subjectField" index="qauthSubject" />
        <property id="720000000000001604" name="roleField" index="qauthRole" />
      </concept>
      <concept id="720000000000000017" name="qiy.structure.ScopeConfig" flags="nn" index="qscopeConfig">
        <property id="720000000000001701" name="resource" index="qscopeResource" />
        <property id="720000000000001702" name="field" index="qscopeField" />
        <property id="720000000000001703" name="claim" index="qscopeClaim" />
      </concept>
      <concept id="720000000000000018" name="qiy.structure.MenuGroup" flags="nn" index="qmenuGroup">
        <property id="720000000000001801" name="label" index="qmenuLabel" />
        <property id="720000000000001802" name="icon" index="qmenuIcon" />
        <property id="720000000000001803" name="parent" index="qmenuParent" />
        <child id="72000000000001801" name="resources" index="qmenuResources" />
      </concept>
      <concept id="720000000000000019" name="qiy.structure.MenuResource" flags="nn" index="qmenuResource">
        <property id="720000000000001901" name="resource" index="qmenuResourceName" />
      </concept>
      <concept id="720000000000000020" name="qiy.structure.DashboardMetric" flags="nn" index="qdashboardMetric">
        <property id="720000000000002001" name="resource" index="qmetricResource" />
        <property id="720000000000002002" name="label" index="qmetricLabel" />
        <property id="720000000000002003" name="icon" index="qmetricIcon" />
        <property id="720000000000002004" name="span" index="qmetricSpan" />
        <property id="720000000000002005" name="type" index="qmetricType" />
        <property id="720000000000002006" name="groupBy" index="qmetricGroupBy" />
        <property id="720000000000002007" name="days" index="qmetricDays" />
      </concept>
      <concept id="720000000000000021" name="qiy.structure.Enum" flags="nn" index="qenum">
        <child id="72000000000002101" name="values" index="qenumValues" />
      </concept>
      <concept id="720000000000000022" name="qiy.structure.EnumValue" flags="nn" index="qenumValue">
        <property id="720000000000002201" name="label" index="qenumLabel" />
        <property id="720000000000002202" name="color" index="qenumColor" />
        <property id="720000000000002203" name="icon" index="qenumIcon" />
      </concept>
      <concept id="720000000000000015" name="qiy.structure.StorageConfig" flags="nn" index="qstorageConfig">
        <property id="720000000000001501" name="provider" index="qstorageProvider" />
      </concept>
      <concept id="720000000000000012" name="qiy.structure.ElysiaConfig" flags="nn" index="qelysiaConfig">
        <property id="720000000000001201" name="bearer" index="qbearer" />
        <property id="720000000000001202" name="serverTiming" index="qserverTiming" />
        <property id="720000000000001203" name="graphqlAdapter" index="qgraphqlAdapter" />
        <property id="720000000000001204" name="jwt" index="qjwt" />
        <property id="720000000000001205" name="static" index="qstatic" />
        <property id="720000000000001206" name="html" index="qhtml" />
        <property id="720000000000001207" name="drizzle" index="qdrizzle" />
        <child id="72000000000001203" name="cron" index="qcron" />
      </concept>
      <concept id="720000000000000013" name="qiy.structure.CronConfig" flags="nn" index="qcronConfig">
        <child id="72000000000001301" name="jobs" index="qjobs" />
      </concept>
      <concept id="720000000000000014" name="qiy.structure.CronJob" flags="nn" index="qcronJob">
        <property id="720000000000001401" name="pattern" index="qpattern" />
        <property id="720000000000001402" name="task" index="qtask" />
      </concept>
      <concept id="720000000000000002" name="qiy.structure.DatabaseConfig" flags="nn" index="qf">
        <property id="720000000000000201" name="dialect" index="qg" />
        <property id="720000000000000202" name="orm" index="qh" />
      </concept>
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
        <property id="720000000000000612" name="precision" index="qprecision" />
        <property id="720000000000000613" name="scale" index="qscale" />
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
  <node concept="qa" id="120000000000001">
    <property role="TrG5h" value="Relations" />
    <property role="qapiClient" value="graphql" />
    <node concept="qf" id="120000000000002" role="qd">
      <property role="TrG5h" value="main" />
      <property role="qg" value="sqlite" />
      <property role="qh" value="drizzle" />
    </node>
    <node concept="qelysiaConfig" id="120000000000018" role="qelysia">
      <property role="qbearer" value="true" />
      <property role="qserverTiming" value="true" />
      <property role="qgraphqlAdapter" value="native" />
      <node concept="qcronConfig" id="120000000000019" role="qcron">
        <node concept="qcronJob" id="120000000000020" role="qjobs">
          <property role="TrG5h" value="cleanup" />
          <property role="qpattern" value="0 * * * *" />
          <property role="qtask" value="cleanupMissingAttachments" />
        </node>
      </node>
    </node>
    <node concept="qstorageConfig" id="120000000000021" role="qstorage">
      <property role="qstorageProvider" value="s3" />
    </node>
    <node concept="qscopeConfig" id="120000000000023" role="qscopes">
      <property role="qscopeResource" value="products" />
      <property role="qscopeField" value="categoryId" />
      <property role="qscopeClaim" value="tenant.categoryId" />
    </node>
    <node concept="qmenuGroup" id="120000000000024" role="qmenuGroups">
      <property role="TrG5h" value="catalog" />
      <property role="qmenuLabel" value="Catalog" />
      <property role="qmenuIcon" value="AppstoreOutlined" />
      <node concept="qmenuResource" id="120000000000025" role="qmenuResources"><property role="qmenuResourceName" value="categories" /></node>
    </node>
    <node concept="qmenuGroup" id="120000000000027" role="qmenuGroups">
      <property role="TrG5h" value="operations" />
      <property role="qmenuLabel" value="Operations" />
      <property role="qmenuParent" value="catalog" />
      <node concept="qmenuResource" id="120000000000028" role="qmenuResources"><property role="qmenuResourceName" value="products" /></node>
    </node>
    <node concept="qdashboardMetric" id="120000000000029" role="qdashboards">
      <property role="TrG5h" value="productCount" />
      <property role="qmetricResource" value="products" />
      <property role="qmetricLabel" value="Products" />
      <property role="qmetricIcon" value="ShoppingOutlined" />
      <property role="qmetricSpan" value="8" />
    </node>
    <node concept="qdashboardMetric" id="120000000000030" role="qdashboards">
      <property role="TrG5h" value="productsByCategory" />
      <property role="qmetricResource" value="products" />
      <property role="qmetricLabel" value="Products by category" />
      <property role="qmetricSpan" value="12" />
      <property role="qmetricType" value="distribution" />
      <property role="qmetricGroupBy" value="status" />
    </node>
    <node concept="qdashboardMetric" id="120000000000031" role="qdashboards">
      <property role="TrG5h" value="productTrend" />
      <property role="qmetricResource" value="products" />
      <property role="qmetricLabel" value="Product trend" />
      <property role="qmetricSpan" value="24" />
      <property role="qmetricType" value="trend" />
      <property role="qmetricGroupBy" value="createdAt" />
      <property role="qmetricDays" value="7" />
    </node>
    <node concept="qenum" id="120000000000032" role="qenums">
      <property role="TrG5h" value="ProductStatus" />
      <node concept="qenumValue" id="120000000000033" role="qenumValues"><property role="TrG5h" value="active" /><property role="qenumLabel" value="Active" /><property role="qenumColor" value="green" /></node>
      <node concept="qenumValue" id="120000000000034" role="qenumValues"><property role="TrG5h" value="archived" /><property role="qenumLabel" value="Archived" /><property role="qenumColor" value="orange" /></node>
    </node>
    <node concept="qk" id="120000000000003" role="qe">
      <property role="TrG5h" value="categories" />
      <property role="ql" value="categories" />
      <node concept="qp" id="120000000000004" role="qo">
        <property role="TrG5h" value="id" />
        <property role="qq" value="UUID" />
        <property role="qt" value="true" />
      </node>
      <node concept="qp" id="120000000000005" role="qo">
        <property role="TrG5h" value="name" />
        <property role="qq" value="Text" />
        <property role="qt" value="false" />
        <property role="qu" value="true" />
      </node>
    </node>
    <node concept="qk" id="120000000000006" role="qe">
      <property role="TrG5h" value="products" />
      <property role="ql" value="products" />
      <node concept="qp" id="120000000000007" role="qo">
        <property role="TrG5h" value="id" />
        <property role="qq" value="UUID" />
        <property role="qt" value="true" />
      </node>
      <node concept="qp" id="120000000000008" role="qo">
        <property role="TrG5h" value="categoryId" />
        <property role="qq" value="UUID" />
        <property role="qs" value="true" />
      </node>
      <node concept="qp" id="120000000000009" role="qo">
        <property role="TrG5h" value="title" />
        <property role="qq" value="Text" />
        <property role="qs" value="false" />
        <property role="qu" value="false" />
        <property role="qr" value="product_title" />
      </node>
      <node concept="qp" id="120000000000035" role="qo"><property role="TrG5h" value="status" /><property role="qq" value="ProductStatus" /><property role="qs" value="false" /></node>
      <node concept="qp" id="120000000000036" role="qo"><property role="TrG5h" value="createdAt" /><property role="qq" value="DateTime" /><property role="qs" value="false" /></node>
      <node concept="qp" id="120000000000017" role="qo">
        <property role="TrG5h" value="unitPrice" />
        <property role="qq" value="Money" />
        <property role="qprecision" value="10" />
        <property role="qscale" value="0" />
      </node>
      <node concept="qindex" id="120000000000011" role="qindexes">
        <property role="TrG5h" value="products_category_title_key" />
        <property role="qmethod" value="btree" />
        <property role="qunique" value="true" />
        <node concept="qcolumn" id="120000000000012" role="qcolumns">
          <property role="qfield" value="categoryId" />
        </node>
        <node concept="qcolumn" id="120000000000013" role="qcolumns">
          <property role="qfield" value="title" />
        </node>
      </node>
      <node concept="qindex" id="120000000000015" role="qindexes">
        <property role="TrG5h" value="products_title_idx" />
        <property role="qmethod" value="btree" />
        <property role="qunique" value="false" />
        <property role="qconcurrently" value="false" />
        <node concept="qcolumn" id="120000000000016" role="qcolumns">
          <property role="qfield" value="title" />
        </node>
      </node>
    </node>
    <node concept="qrelation" id="120000000000010" role="qrelations">
      <property role="TrG5h" value="productCategory" />
      <property role="qfromEntity" value="products" />
      <property role="qfromField" value="categoryId" />
      <property role="qtoEntity" value="categories" />
      <property role="qtoField" value="id" />
      <property role="qcardinality" value="one" />
      <property role="qonDelete" value="setNull" />
    </node>
  </node>
</model>
