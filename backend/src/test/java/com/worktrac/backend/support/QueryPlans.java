package com.worktrac.backend.support;

import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

// Reads the table accesses out of a SQL Server showplan XML: which table, through which index, and
// whether it was a seek, a scan or a key lookup. Shared by the cost tests (HistorySyncCostTest, and
// the stats probe), because "does this statement cost in proportion to the person or to the table"
// is a property of the plan's shape, and every one of them asks it the same way.
public final class QueryPlans {

    private QueryPlans() {
    }

    public record Access(String table, String index, String physicalOp, boolean lookup, Set<String> seekColumns) {
    }

    // Each operator that reads a table directly: the <RelOp> whose child is an <IndexScan> or
    // <TableScan>. A key lookup is a Clustered Index Seek whose IndexScan carries Lookup="true".
    public static List<Access> accesses(String planXml) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(false);
        var document = factory.newDocumentBuilder()
                .parse(new ByteArrayInputStream(planXml.getBytes(StandardCharsets.UTF_8)));
        List<Access> accesses = new ArrayList<>();
        NodeList relOps = document.getElementsByTagName("RelOp");
        for (int i = 0; i < relOps.getLength(); i++) {
            Element relOp = (Element) relOps.item(i);
            for (Node child = relOp.getFirstChild(); child != null; child = child.getNextSibling()) {
                if (!(child instanceof Element reader)
                        || !(reader.getTagName().equals("IndexScan") || reader.getTagName().equals("TableScan"))) {
                    continue;
                }
                Element object = (Element) reader.getElementsByTagName("Object").item(0);
                String lookup = reader.getAttribute("Lookup");
                // The key columns a seek actually narrows on: every ColumnReference under a RangeColumns
                // of its SeekPredicates. (person_id alone is a pass over the person's whole range.)
                Set<String> seekColumns = new TreeSet<>();
                NodeList ranges = reader.getElementsByTagName("RangeColumns");
                for (int r = 0; r < ranges.getLength(); r++) {
                    NodeList columns = ((Element) ranges.item(r)).getElementsByTagName("ColumnReference");
                    for (int c = 0; c < columns.getLength(); c++) {
                        seekColumns.add(strip(((Element) columns.item(c)).getAttribute("Column")));
                    }
                }
                accesses.add(new Access(
                        strip(object.getAttribute("Table")), strip(object.getAttribute("Index")),
                        relOp.getAttribute("PhysicalOp"), "true".equals(lookup) || "1".equals(lookup), seekColumns));
            }
        }
        return accesses;
    }

    private static String strip(String bracketed) {
        return bracketed.replace("[", "").replace("]", "");
    }
}
